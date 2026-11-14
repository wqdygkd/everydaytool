/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { withArchiveMessageLock } from '../backend/archive/message-lock.ts'

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

test('同一消息目录的读写按进入顺序串行执行', async () => {
  const dir = join(tmpdir(), 'edt-message-lock-same')
  const events: string[] = []

  const first = withArchiveMessageLock(dir, async () => {
    events.push('first:start')
    await wait(20)
    events.push('first:end')
    return 'first'
  })
  const second = withArchiveMessageLock(dir, async () => {
    events.push('second:start')
    events.push('second:end')
    return 'second'
  })

  assert.deepEqual(await Promise.all([first, second]), ['first', 'second'])
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end'])
})

test('任务抛错后仍会释放队列', async () => {
  const dir = join(tmpdir(), 'edt-message-lock-error')
  await assert.rejects(
    withArchiveMessageLock(dir, async () => {
      throw new Error('boom')
    }),
    /boom/,
  )
  assert.equal(await withArchiveMessageLock(dir, async () => 'ok'), 'ok')
})
