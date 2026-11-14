/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { decompressLayerFile } from '../backend/utils/decompress.ts'
import { TarWriter } from '../backend/utils/tar-builder.ts'

test('镜像层流式解压并计算 diff_id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edt-layer-stream-'))
  try {
    const raw = Buffer.from('layer content '.repeat(2000))
    const source = join(dir, 'layer.gz')
    const destination = join(dir, 'layer.tar')
    await writeFile(source, gzipSync(raw))

    const result = await decompressLayerFile(source, destination)
    assert.equal(result.size, raw.length)
    assert.equal(result.diffId, `sha256:${createHash('sha256').update(raw).digest('hex')}`)
    assert.deepEqual(await readFile(destination), raw)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('TAR 从文件流式写入并补齐 512 字节块', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edt-tar-stream-'))
  try {
    const content = Buffer.from('x'.repeat(1000))
    const source = join(dir, 'payload.bin')
    const destination = join(dir, 'out.tar')
    await writeFile(source, content)

    const writer = new TarWriter(destination)
    await writer.addFileFromPath('payload.bin', source, content.length)
    await writer.end()

    const info = await stat(destination)
    assert.equal(info.size, 512 + 1000 + 24 + 1024)
    assert.equal(info.size % 512, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
