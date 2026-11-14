/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolvePathInside } from '../backend/utils/history-path.ts'

test('下载历史只允许删除下载目录内的路径', () => {
  const root = path.join(tmpdir(), 'edt-offline-pack-downloads')

  assert.equal(resolvePathInside(root, path.join(root, 'tool.zip')), path.join(root, 'tool.zip'))
  assert.equal(resolvePathInside(root, path.join(root, 'nested', 'tool.zip')), path.join(root, 'nested', 'tool.zip'))
  assert.equal(resolvePathInside(root, path.join(root, '..', 'evil.zip')), null)
  assert.equal(resolvePathInside(root, `${root}-evil/tool.zip`), null)
  assert.equal(resolvePathInside(root, root), null)
})
