/* eslint-disable test/no-import-node-test */
import type { IncomingMessage, ServerResponse } from 'node:http'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { downloadToFile, HttpDownloadTimeoutError } from '../utils/http-download.ts'

type Handler = (req: IncomingMessage, res: ServerResponse) => void

async function withServer(handler: Handler, run: (url: string) => Promise<void>): Promise<void> {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const url = `http://127.0.0.1:${address.port}/file`
  const close = async (): Promise<void> => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
  try {
    await run(url)
  }
  finally {
    await close().catch(() => {})
  }
}

test('downloadToFile 在正文阶段按空闲时间超时', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    res.write('partial')
  }, async (url) => {
    const root = await mkdtemp(join(tmpdir(), 'edt-http-download-'))
    const dest = join(root, 'file.bin')
    try {
      await assert.rejects(
        downloadToFile(url, dest, { idleTimeoutMs: 80 }, fetch),
        (error: unknown) => error instanceof HttpDownloadTimeoutError,
      )
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

test('downloadToFile 在正文阶段响应取消信号', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    const timer = setInterval(() => res.write('chunk'), 20)
    res.on('close', () => clearInterval(timer))
  }, async (url) => {
    const root = await mkdtemp(join(tmpdir(), 'edt-http-download-'))
    const dest = join(root, 'file.bin')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 80)
    try {
      await assert.rejects(
        downloadToFile(url, dest, { signal: controller.signal, idleTimeoutMs: 5_000 }, fetch),
        (error: unknown) => (error as Error).name === 'AbortError',
      )
    }
    finally {
      clearTimeout(timer)
      await rm(root, { recursive: true, force: true })
    }
  })
})

test('downloadToFile 完整落盘并上报进度', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': '5' })
    res.end('hello')
  }, async (url) => {
    const root = await mkdtemp(join(tmpdir(), 'edt-http-download-'))
    const dest = join(root, 'file.bin')
    const progress: number[] = []
    try {
      await downloadToFile(url, dest, { onProgress: downloaded => progress.push(downloaded) }, fetch)
      assert.equal(await readFile(dest, 'utf8'), 'hello')
      assert.deepEqual(progress, [5])
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

test('downloadToFile 增量校验 sha256', async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': '5' })
    res.end('hello')
  }, async (url) => {
    const root = await mkdtemp(join(tmpdir(), 'edt-http-download-sha-'))
    const dest = join(root, 'file.bin')
    const digest = createHash('sha256').update('hello').digest('hex')
    try {
      await downloadToFile(url, dest, { expectedSha256: `sha256:${digest}` }, fetch)
      assert.equal(await readFile(dest, 'utf8'), 'hello')
      await assert.rejects(
        downloadToFile(url, join(root, 'bad.bin'), { expectedSha256: '0'.repeat(64) }, fetch),
        /SHA-256 校验失败/,
      )
    }
    finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
