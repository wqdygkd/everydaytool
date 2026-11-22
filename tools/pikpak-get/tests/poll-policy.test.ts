/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { POLL_DELAYS, pollDelayMs } from '../renderer/poll-policy.ts'

test('右侧任务面板打开时最快（1s），即使有活跃任务', () => {
  assert.equal(pollDelayMs({ panelOpen: true, activeTasks: 0, knownTasks: 0 }), POLL_DELAYS.panel)
  assert.equal(pollDelayMs({ panelOpen: true, activeTasks: 3, knownTasks: 9 }), POLL_DELAYS.panel)
})

test('有活跃任务时 1.5s', () => {
  assert.equal(pollDelayMs({ panelOpen: false, activeTasks: 1, knownTasks: 5 }), POLL_DELAYS.active)
})

test('只剩历史任务时降频到 4s', () => {
  assert.equal(pollDelayMs({ panelOpen: false, activeTasks: 0, knownTasks: 3 }), POLL_DELAYS.history)
})

test('完全空闲时 6s', () => {
  assert.equal(pollDelayMs({ panelOpen: false, activeTasks: 0, knownTasks: 0 }), POLL_DELAYS.idle)
})

test('节奏单调：面板 < 活跃 < 历史 < 空闲', () => {
  assert.ok(POLL_DELAYS.panel < POLL_DELAYS.active)
  assert.ok(POLL_DELAYS.active < POLL_DELAYS.history)
  assert.ok(POLL_DELAYS.history < POLL_DELAYS.idle)
})
