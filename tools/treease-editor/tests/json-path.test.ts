/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import test from 'node:test'
import { hasUnsafeJsonPath, isUnsafeJsonPathSegment } from '../backend/utils/json-path.ts'

test('JSON 路径拒绝原型污染段', () => {
  assert.equal(isUnsafeJsonPathSegment('__proto__'), true)
  assert.equal(isUnsafeJsonPathSegment('constructor'), true)
  assert.equal(isUnsafeJsonPathSegment('prototype'), true)
  assert.equal(isUnsafeJsonPathSegment('data'), false)
  assert.equal(hasUnsafeJsonPath('a.__proto__.polluted'), true)
  assert.equal(hasUnsafeJsonPath('a.constructor.prototype.x'), true)
  assert.equal(hasUnsafeJsonPath('a.b.c'), false)
})
