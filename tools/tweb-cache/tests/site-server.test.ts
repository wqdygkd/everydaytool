/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  startArchiveSiteServer,
  stopArchiveSiteServer,
} from '../backend/archive/site-server.ts'

const BODY = Buffer.from('thumbnail-bytes')

async function startFixture(): Promise<{ origin: string, token: string, dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'edt-site-'))
  await writeFile(path.join(dir, 'index.html'), '<!doctype html><html><body>ok</body></html>', 'utf8')
  const info = await startArchiveSiteServer({
    rootDir: dir,
    resolveMedia: key => (key === 'thumb_demo'
      ? { absolutePath: path.join(dir, 'thumb_demo.jpg'), size: BODY.length, mimeType: 'image/jpeg' }
      : undefined),
    token: 'test-token',
  })
  await writeFile(path.join(dir, 'thumb_demo.jpg'), BODY)
  return { origin: info.url, token: info.token, dir }
}

test('媒体子资源允许跨站 Sec-Fetch-Site（应用渲染层 <img> 直接引用）', async () => {
  const fixture = await startFixture()
  try {
    const response = await fetch(`${fixture.origin}media/thumb_demo?t=${fixture.token}`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/jpeg')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), BODY)
  } finally {
    stopArchiveSiteServer()
    await rm(fixture.dir, { recursive: true, force: true })
  }
})

test('媒体子资源仍然要求 token', async () => {
  const fixture = await startFixture()
  try {
    const response = await fetch(`${fixture.origin}media/thumb_demo`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    assert.equal(response.status, 401)
  } finally {
    stopArchiveSiteServer()
    await rm(fixture.dir, { recursive: true, force: true })
  }
})

test('API 仍然拒绝跨站请求', async () => {
  const fixture = await startFixture()
  try {
    const response = await fetch(`${fixture.origin}api/health`, {
      headers: { 'sec-fetch-site': 'cross-site', 'x-edt-token': fixture.token },
    })
    assert.equal(response.status, 403)
  } finally {
    stopArchiveSiteServer()
    await rm(fixture.dir, { recursive: true, force: true })
  }
})
