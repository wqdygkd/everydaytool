/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import test from 'node:test'
import { assertWxpExtraArgs, parseWxpExtraArgs } from '../../../shared/wxp.ts'

test('WXP 额外参数分词与危险开关黑名单', () => {
  assert.deepEqual(parseWxpExtraArgs('--lang=zh-CN  "--foo bar"'), ['--lang=zh-CN', '--foo bar'])
  assert.throws(() => assertWxpExtraArgs('--load-extension=/tmp/x'), /不允许使用 --load-extension/)
  assert.throws(() => assertWxpExtraArgs('--remote-debugging-port=1'), /不允许使用 --remote-debugging-port/)
  assert.doesNotThrow(() => assertWxpExtraArgs('--lang=zh-CN --disable-gpu'))
})
