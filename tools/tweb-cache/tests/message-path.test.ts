/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import test from 'node:test'
import { archiveMessageDirName } from '../backend/archive/message-path.ts'

test('消息目录名按 15 位补零（索引里的 902 不能直接当目录名）', () => {
  assert.equal(archiveMessageDirName(902), '000000000000902')
  assert.equal(archiveMessageDirName(1), '000000000000001')
  assert.equal(archiveMessageDirName(123_456_789_012_345), '123456789012345')
})

test('非法消息号拒绝生成目录名', () => {
  assert.throws(() => archiveMessageDirName(0), /消息 id 非法/)
  assert.throws(() => archiveMessageDirName(-1), /消息 id 非法/)
  assert.throws(() => archiveMessageDirName(Number.NaN), /消息 id 非法/)
})
