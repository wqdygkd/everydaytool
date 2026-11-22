/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatBytes,
  formatDuration,
  formatFileDone,
  formatFileProgress,
  formatPercent,
  formatQueue,
  formatSpeed,
  formatTaskEnd,
  formatTaskQueued,
  PROGRESS_PREFIX,
} from '../backend/engine/progress-log.ts'

const IDLE = { tasks: 0, files: 0, bytes: 0 }
const BUSY = { tasks: 2, files: 7, bytes: 1.2 * 1024 ** 3 }

test('formatBytes 用二进制单位', () => {
  assert.equal(formatBytes(0), '0.0B')
  assert.equal(formatBytes(1024), '1.0KiB')
  assert.equal(formatBytes(142.8 * 1024 ** 2), '142.8MiB')
  assert.equal(formatBytes(1.2 * 1024 ** 3), '1.2GiB')
})

test('formatSpeed / formatPercent 边界', () => {
  assert.equal(formatSpeed(45.6 * 1024 ** 2), '45.6MiB/s')
  assert.equal(formatSpeed(-1), '0.0B/s')
  assert.equal(formatPercent(0, 0), '--')
  assert.equal(formatPercent(50, 200), '25.0%')
  assert.equal(formatPercent(300, 200), '100.0%')
})

test('formatDuration 分 / 时两档', () => {
  assert.equal(formatDuration(0), '00:00')
  assert.equal(formatDuration(125), '02:05')
  assert.equal(formatDuration(3725), '1:02:05')
})

test('formatQueue 空闲 / 排队两种说法', () => {
  assert.equal(formatQueue(IDLE), '队列空闲')
  assert.equal(formatQueue(BUSY), '排队 2 个任务 · 7 个文件 · 1.2GiB')
})

test('入队 / 进度 / 结束三类行都带前缀且含队列信息', () => {
  const queued = formatTaskQueued('task-1', 3, 142.8 * 1024 ** 2, BUSY)
  assert.ok(queued.startsWith(PROGRESS_PREFIX))
  assert.ok(queued.includes('入队 task-1'))
  assert.ok(queued.includes('3 个文件'))
  assert.ok(queued.includes('排队 2 个任务'))

  const progress = formatFileProgress(1, 3, '第1集.mkv', 53 * 1024 ** 2, 142.8 * 1024 ** 2, 45.6 * 1024 ** 2, 125, BUSY)
  assert.ok(progress.includes('下载中 1/3 第1集.mkv'))
  assert.ok(progress.includes('37.1%'))
  assert.ok(progress.includes('45.6MiB/s'))
  assert.ok(progress.includes('剩余 02:05'))
  assert.ok(progress.includes('排队 2 个任务'))

  const end = formatTaskEnd('task-1', 'done', 3, 3, IDLE)
  assert.ok(end.includes('结束 task-1 done（3/3 个文件）'))
  assert.ok(end.includes('队列空闲'))
})

test('文件完成行给出用时与均速', () => {
  const line = formatFileDone(2, 3, '第2集.mkv', 100 * 1024 ** 2, 50)
  assert.ok(line.includes('完成 2/3 第2集.mkv'))
  assert.ok(line.includes('用时 00:50'))
  assert.ok(line.includes('均速 2.0MiB/s'))
})
