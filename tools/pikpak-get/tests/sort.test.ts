/* eslint-disable test/no-import-node-test -- Node 内置 test runner */
import type { PikpakGetNode } from '../../../shared/pikpak-get.ts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pikpakNodeExtension, sortPikpakNodes } from '../../../shared/pikpak-get.ts'

function node(id: string, name: string, size: number, isFolder = false): PikpakGetNode {
  return {
    id,
    name,
    path: `/${name}`,
    parentId: '',
    isFolder,
    size,
    hash: null,
    mime: '',
    childCount: null,
    downloaded: false,
    exists: false,
  }
}

const LIST: PikpakGetNode[] = [
  node('c', '第10集.mkv', 300),
  node('a', '第2集.mkv', 100),
  node('f', 'subs', 0, true),
  node('b', 'a.srt', 20),
]

test('default 保留引擎原始顺序', () => {
  assert.deepEqual(sortPikpakNodes(LIST, 'default').map(item => item.id), ['c', 'a', 'f', 'b'])
})

test('按文件名：数字感知升序，文件夹恒在前', () => {
  assert.deepEqual(sortPikpakNodes(LIST, 'name').map(item => item.id), ['f', 'a', 'c', 'b'])
})

test('按文件名降序：只翻转同组内顺序，文件夹仍在最前', () => {
  assert.deepEqual(sortPikpakNodes(LIST, 'name', true).map(item => item.id), ['f', 'b', 'c', 'a'])
})

test('按大小：升序 / 降序，文件夹恒在前', () => {
  assert.deepEqual(sortPikpakNodes(LIST, 'size').map(item => item.id), ['f', 'b', 'a', 'c'])
  assert.deepEqual(sortPikpakNodes(LIST, 'size', true).map(item => item.id), ['f', 'c', 'a', 'b'])
})

test('按后缀：同后缀再按文件名', () => {
  const list = [node('1', 'b.srt', 1), node('2', 'a.mkv', 1), node('3', 'a.srt', 1)]
  assert.deepEqual(sortPikpakNodes(list, 'ext').map(item => item.id), ['2', '3', '1'])
})

test('大小相同的文件按文件名兜底排序', () => {
  const list = [node('1', 'b.mkv', 50), node('2', 'a.mkv', 50)]
  assert.deepEqual(sortPikpakNodes(list, 'size').map(item => item.id), ['2', '1'])
})

test('不改动入参', () => {
  const before = LIST.map(item => item.id)
  sortPikpakNodes(LIST, 'name', true)
  assert.deepEqual(LIST.map(item => item.id), before)
})

test('后缀解析', () => {
  assert.equal(pikpakNodeExtension('movie.MKV'), 'mkv')
  assert.equal(pikpakNodeExtension('noext'), '')
  assert.equal(pikpakNodeExtension('.gitignore'), '')
  assert.equal(pikpakNodeExtension('a.b.srt'), 'srt')
})
