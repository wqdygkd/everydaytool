/* eslint-disable test/no-import-node-test -- 使用 Node 内置 test runner，避免新增 Vitest 依赖 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  formatGlobalLock,
  parseGlobalLock,
  readGlobalLock,
} from '../backend/locks/global-lock.ts'
import {
  formatProjectLock,
  getProjectLockPath,
  parseProjectLock,
  readProjectLock,
} from '../backend/locks/project-lock.ts'

test('项目锁：真实仓库可读、34 条、规范格式可逐字节还原', async () => {
  const result = await readProjectLock(process.cwd())
  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.equal(result.exists, true)
  assert.equal(result.data.version, 1)
  assert.equal(Object.keys(result.data.skills).length, 34)
  assert.ok(result.data.skills['ask-matt'])

  const raw = await readFile(getProjectLockPath(process.cwd()), 'utf8')
  assert.equal(formatProjectLock(result.data), raw)
})

test('项目锁：不存在时返回空 v1，而不是错误', async () => {
  const result = await readProjectLock(join(tmpdir(), 'skill-manager-no-such-project'))
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.exists, false)
  assert.deepEqual(result.data, { version: 1, skills: {} })
})

test('项目锁：保留未知字段，写回按技能名排序', () => {
  const raw = `${JSON.stringify({
    version: 1,
    extraRoot: { keep: true },
    skills: {
      zebra: { source: 'o/r', sourceType: 'github', computedHash: 'h2', mystery: 2 },
      alpha: { source: 'o/r', sourceType: 'github', computedHash: 'h1', mystery: 1 },
    },
  }, null, 2)}\n`

  const parsed = parseProjectLock(raw)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return

  assert.deepEqual(Object.keys(parsed.data.skills), ['zebra', 'alpha'])
  const formatted = formatProjectLock(parsed.data)
  assert.match(formatted, /"extraRoot"/)
  assert.match(formatted, /"mystery"/)
  assert.ok(formatted.indexOf('"alpha"') < formatted.indexOf('"zebra"'))
  assert.ok(formatted.endsWith('\n'))
})

test('项目锁：无效 JSON / 未知版本 / 缺字段都会拒绝', () => {
  assert.equal(parseProjectLock('{').ok, false)
  assert.equal(parseProjectLock(JSON.stringify({ version: 2, skills: {} })).ok, false)
  assert.equal(parseProjectLock(JSON.stringify({ version: 1, skills: { a: { source: 'o/r', sourceType: 'github' } } })).ok, false)
})

test('全局锁：v3 可读、无尾换行、保留未知字段', () => {
  const raw = JSON.stringify({
    version: 3,
    extraRoot: true,
    skills: {
      alpha: {
        source: 'o/r',
        sourceType: 'github',
        sourceUrl: 'https://github.com/o/r',
        skillFolderHash: 'tree-sha',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        mystery: 1,
      },
    },
  }, null, 2)

  const parsed = parseGlobalLock(raw)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return

  assert.equal(parsed.data.version, 3)
  assert.equal(formatGlobalLock(parsed.data), raw)
  assert.ok(!formatGlobalLock(parsed.data).endsWith('\n'))
})

test('全局锁：v1/v2 拒绝，提示 CLI 会清空旧版', () => {
  const parsed = parseGlobalLock(JSON.stringify({ version: 2, skills: {} }))
  assert.equal(parsed.ok, false)
  if (parsed.ok) return
  assert.equal(parsed.reason, 'unsupported')
  assert.match(parsed.message, /v3/)
})

test('全局锁：真实文件存在时只读且格式一致', async () => {
  const result = await readGlobalLock()
  assert.equal(result.ok, true)
  if (!result.ok || !result.exists) return
  assert.equal(result.data.version, 3)
  assert.equal(formatGlobalLock(result.data), result.raw)
})
