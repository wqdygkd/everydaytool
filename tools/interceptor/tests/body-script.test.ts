/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import test from 'node:test'
import { runRequestBodyScript } from '../backend/services/body-script.ts'

test('请求体脚本在 worker 中返回改写结果', async () => {
  const result = await runRequestBodyScript(
    'async function modifyRequestBody(args) { console.log("ok"); return { ...args.bodyAsJson, b: 2 } }',
    { method: 'POST', url: 'https://example.com', body: '{"a":1}' },
  )
  assert.equal(result, '{"a":1,"b":2}')
})

test('请求体脚本 await 后死循环会被超时终止', async () => {
  const started = Date.now()
  const result = await runRequestBodyScript(
    'async function modifyRequestBody() { while (true) { await Promise.resolve() } }',
    { method: 'GET', url: 'https://example.com', body: '' },
  )
  assert.equal(result, null)
  assert.ok(Date.now() - started < 3000)
})
