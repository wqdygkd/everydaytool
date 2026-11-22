/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeKeycheck, openSealed, seal, verifyKeycheck } from '../backend/engine/crypto.ts'

const MASTER_KEY = 'a-test-master-key-0123456789'

test('edt-kdf:v1 roundtrip', () => {
  const sealed = seal('hello-secret', MASTER_KEY, 'account-1', 'password')
  assert.ok(sealed.startsWith('edt-kdf:v1:'))
  assert.equal(openSealed(sealed, MASTER_KEY, 'account-1', 'password'), 'hello-secret')
})

test('salt and nonce are random', () => {
  const first = seal('same', MASTER_KEY, 'account-1', 'password')
  const second = seal('same', MASTER_KEY, 'account-1', 'password')
  assert.notEqual(first, second)
})

test('wrong master key fails', () => {
  const sealed = seal('hello', MASTER_KEY, 'account-1', 'password')
  assert.throws(() => openSealed(sealed, 'wrong-key', 'account-1', 'password'))
})

test('wrong aad fails', () => {
  const sealed = seal('hello', MASTER_KEY, 'account-1', 'password')
  assert.throws(() => openSealed(sealed, MASTER_KEY, 'account-1', 'session'))
})

test('tampered envelope fails', () => {
  const sealed = seal('hello', MASTER_KEY, 'account-1', 'password')
  const parts = sealed.split(':')
  parts[parts.length - 1] = `A${parts[parts.length - 1]!.slice(1)}`
  assert.throws(() => openSealed(parts.join(':'), MASTER_KEY, 'account-1', 'password'))
})

test('unicode roundtrip', () => {
  const sealed = seal('中文密码🔐', MASTER_KEY, 'account-1', 'password')
  assert.equal(openSealed(sealed, MASTER_KEY, 'account-1', 'password'), '中文密码🔐')
})

test('keycheck', () => {
  const sealed = makeKeycheck(MASTER_KEY)
  assert.ok(verifyKeycheck(sealed, MASTER_KEY))
  assert.equal(verifyKeycheck(sealed, 'wrong-key'), false)
})
