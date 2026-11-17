/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import test from 'node:test'
import { makeEnvelope } from '../../../shared/extension.ts'
import { encodeEdtMessage } from '../backend/services/ws-envelope.ts'
import { MAX_WS_MESSAGE_BYTES, parseExtensionMessage } from '../backend/services/ws-message.ts'

test('WS 握手必须带令牌，未认证时拒绝业务消息', () => {
  const hello = parseExtensionMessage(JSON.stringify({
    type: 'hello',
    appId: 'chrome',
    clientId: 'c1',
    version: '1',
    token: 'abc',
  }), false)
  assert.equal(hello?.type, 'hello')
  assert.equal(parseExtensionMessage(JSON.stringify({ type: 'hello', appId: 'chrome', clientId: 'c1', version: '1' }), false), null)
  assert.equal(parseExtensionMessage(JSON.stringify({ type: 'ping', at: 1 }), false), null)
})

test('WS 消息按类型校验并限制体积', () => {
  assert.equal(parseExtensionMessage(JSON.stringify({ type: 'add-target', url: 'file:///etc/passwd' }), true), null)
  assert.equal(parseExtensionMessage(JSON.stringify({ type: 'add-target', url: 'https://example.com' }), true)?.type, 'add-target')
  assert.equal(parseExtensionMessage(JSON.stringify({ type: 'rule-toggle', id: 'r', enabled: true }), true)?.type, 'rule-toggle')
  assert.equal(parseExtensionMessage('x'.repeat(MAX_WS_MESSAGE_BYTES + 1), true), null)
})

test('平台信封握手与业务消息可解码', () => {
  const hello = parseExtensionMessage(JSON.stringify(makeEnvelope('shell', 'hello', {
    appId: 'chrome',
    clientId: 'c1',
    version: '2.0.0',
    token: 'abc',
  })), false)
  assert.equal(hello?.type, 'hello')
  if (hello?.type !== 'hello') return
  assert.equal(hello.token, 'abc')

  const add = parseExtensionMessage(JSON.stringify(makeEnvelope('interceptor', 'add-target', {
    url: 'https://example.com',
  })), true)
  assert.equal(add?.type, 'add-target')

  const encoded = encodeEdtMessage({
    type: 'hello-ok',
    wsPort: 59763,
    proxyPort: 3000,
    targets: [],
    scripts: [],
    rules: [],
    proxyDesired: null,
  })
  assert.equal(encoded.module, 'shell')
  assert.equal(encoded.type, 'hello-ok')
  const payload = encoded.payload as { modules?: string[], bootstraps?: { interceptor?: { proxyPort?: number } } }
  assert.deepEqual(payload.modules, ['interceptor'])
  assert.equal(payload.bootstraps?.interceptor?.proxyPort, 3000)
})
