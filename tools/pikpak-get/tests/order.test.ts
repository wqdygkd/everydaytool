/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { orderBySelection } from '../backend/engine/order.ts'

const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

test('按给定顺序重排', () => {
  assert.deepEqual(orderBySelection(nodes, ['c', 'a', 'b']).map(node => node.id), ['c', 'a', 'b'])
})

test('没有顺序表时保持原顺序', () => {
  assert.deepEqual(orderBySelection(nodes, null).map(node => node.id), ['a', 'b', 'c'])
  assert.deepEqual(orderBySelection(nodes, []).map(node => node.id), ['a', 'b', 'c'])
})

test('顺序表里没提到的节点排在后面，且保持相对次序', () => {
  assert.deepEqual(orderBySelection(nodes, ['c']).map(node => node.id), ['c', 'a', 'b'])
})

test('顺序表里的多余 id 被忽略，重复 id 以首次出现为准', () => {
  assert.deepEqual(orderBySelection(nodes, ['b', 'b', 'zzz', 'a']).map(node => node.id), ['b', 'a', 'c'])
})

test('不改动入参', () => {
  const before = nodes.map(node => node.id)
  orderBySelection(nodes, ['c', 'b', 'a'])
  assert.deepEqual(nodes.map(node => node.id), before)
})
