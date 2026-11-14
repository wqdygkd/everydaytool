/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'
import { toTrafficSummary } from '../../../shared/interceptor.ts'

test('流量摘要丢弃请求 / 响应头与正文', () => {
  const entry = {
    id: 't-1',
    at: 1,
    method: 'GET',
    url: 'https://example.com/a',
    scheme: 'https' as const,
    host: 'example.com',
    path: '/a',
    status: 200,
    requestHeaders: { accept: '*/*' },
    requestBody: 'req',
    responseHeaders: { 'content-type': 'text/plain' },
    responseBody: 'res',
    bodyTruncated: true,
  }
  const summary = toTrafficSummary(entry)
  assert.equal(summary.id, 't-1')
  assert.equal(summary.url, entry.url)
  assert.equal('requestHeaders' in summary, false)
  assert.equal('requestBody' in summary, false)
  assert.equal('responseHeaders' in summary, false)
  assert.equal('responseBody' in summary, false)
  assert.equal('bodyTruncated' in summary, false)
})
