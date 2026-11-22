/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toIpcPayload } from '../renderer/ipc-payload.ts'

// 回归背景：渲染层把 reactive / ref 取出的值直接传给 IPC，Electron 的结构化克隆
// 遇到 Proxy 会抛「An object could not be cloned.」（勾选文件后点下载即触发）。
// 这里用原生 Proxy 复刻同一种载荷形状。

function reactiveLike<T extends object>(target: T): T {
  return new Proxy(target, {})
}

test('Proxy 载荷本身过不了结构化克隆（复刻线上报错）', () => {
  assert.throws(() => structuredClone(reactiveLike({ linkId: 'l1', fileIds: ['a'] })), /could not be cloned/)
})

test('拍平后可以正常结构化克隆', () => {
  const payload = { linkId: 'l1', fileIds: reactiveLike(['a', 'b']) }
  const plain = toIpcPayload(reactiveLike(payload))
  assert.doesNotThrow(() => structuredClone(plain))
  assert.deepEqual(structuredClone(plain), { linkId: 'l1', fileIds: ['a', 'b'] })
})

test('嵌套数组被拷贝，不与源共享引用', () => {
  const source = { fileIds: ['a'] }
  const plain = toIpcPayload(reactiveLike(source)) as { fileIds: string[] }
  plain.fileIds.push('b')
  assert.deepEqual(source.fileIds, ['a'])
})

test('基础类型与 null / undefined 原样返回', () => {
  assert.equal(toIpcPayload('abc'), 'abc')
  assert.equal(toIpcPayload(7), 7)
  assert.equal(toIpcPayload(false), false)
  assert.equal(toIpcPayload(null), null)
  assert.equal(toIpcPayload(undefined), undefined)
})

test('对象里的 undefined 字段按 JSON 语义丢弃（主进程按缺省处理）', () => {
  const plain = toIpcPayload({ mode: 'local', name: undefined, url: undefined }) as Record<string, unknown>
  assert.deepEqual(plain, { mode: 'local' })
  assert.equal(plain.name, undefined)
})
