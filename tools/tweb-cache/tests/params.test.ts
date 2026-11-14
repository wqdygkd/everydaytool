/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  readMessageIdValue,
  readOptionalDays,
  readPeerIdValue,
  readStatusHints,
  readTrashId,
} from '../backend/archive/params.ts'

test('归档参数校验在 HTTP / IPC 入口共用', () => {
  assert.equal(readPeerIdValue('-100123'), '-100123')
  assert.throws(() => readPeerIdValue('../1'), /peer 非法/)
  assert.equal(readMessageIdValue('42'), 42)
  assert.throws(() => readMessageIdValue(0), /messageId 非法/)
  assert.equal(readTrashId('trash_1'), 'trash_1')
  assert.throws(() => readTrashId('../x'), /回收站条目非法/)
  assert.equal(readOptionalDays(undefined, 'days'), undefined)
  assert.equal(readOptionalDays(3, 'days'), 3)
  assert.throws(() => readOptionalDays(-1, 'days'), /days 非法/)
})

test('状态线索只保留合法字段与长度上限', () => {
  const hints = readStatusHints([
    {
      messageId: 7,
      forwardSource: { id: '-1001', messageId: 9 },
      mediaKeys: ['a.jpg', '../bad', 'b.png'],
      textChars: 12,
    },
    { messageId: 0 },
  ])
  assert.deepEqual(hints, [{
    messageId: 7,
    forwardSource: { id: '-1001', messageId: 9 },
    mediaKeys: ['a.jpg', 'b.png'],
    textChars: 12,
  }])
})
