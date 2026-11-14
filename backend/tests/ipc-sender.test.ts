/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'
import { isTrustedIpcSenderUrl } from '../utils/ipc-sender.ts'

test('IPC 来源默认不信任任意回环 HTTP', () => {
  assert.equal(isTrustedIpcSenderUrl('http://localhost:9000/', { appPath: '/tmp/app' }), false)
  assert.equal(isTrustedIpcSenderUrl('http://127.0.0.1:5173/', {
    appPath: '/tmp/app',
    allowLoopbackHttp: true,
    devServerPort: 5173,
  }), true)
  assert.equal(isTrustedIpcSenderUrl('http://127.0.0.1:5174/', {
    appPath: '/tmp/app',
    allowLoopbackHttp: true,
    devServerPort: 5173,
  }), false)
})
