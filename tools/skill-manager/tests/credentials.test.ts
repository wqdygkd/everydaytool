/* eslint-disable test/no-import-node-test -- 使用 Node 内置 test runner，避免新增 Vitest 依赖 */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  deleteToken,
  listTokenHosts,
  normalizeTokenHost,
  readToken,
  saveToken,
} from '../backend/services/credentials-core.ts'
import { normalizeSkillManagerSettings } from '../backend/services/settings.ts'

const codec = {
  seal: (value: string) => `edt-secret:${Buffer.from(value).toString('base64')}`,
  open: (value: string) => ({
    value: value.startsWith('edt-secret:') ? Buffer.from(value.slice('edt-secret:'.length), 'base64').toString() : value,
    failed: false,
  }),
}

test('令牌：按 host 保存、只返回脱敏视图、可删除', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'edt-skill-token-'))
  const path = join(dir, 'credentials.json')
  try {
    assert.equal(normalizeTokenHost('https://TFS.Example.local:8080/tfs/Collection'), 'tfs.example.local:8080')
    const first = saveToken(path, 'https://tfs.example.local:8080/tfs/Collection', 'pat-123', codec)
    assert.deepEqual(first.hosts.map(item => item.host), ['tfs.example.local:8080'])
    assert.equal(first.hosts[0]?.sealed, true)
    assert.equal(JSON.stringify(first).includes('pat-123'), false)
    assert.equal(readToken(path, 'tfs.example.local:8080', codec), 'pat-123')

    saveToken(path, 'github.com', 'gh-token', codec)
    assert.deepEqual(listTokenHosts(path, codec).hosts.map(item => item.host), ['github.com', 'tfs.example.local:8080'])

    deleteToken(path, 'github.com', codec)
    assert.deepEqual(listTokenHosts(path, codec).hosts.map(item => item.host), ['tfs.example.local:8080'])
    assert.equal(readToken(path, 'github.com', codec), undefined)
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('设置：新字段兼容旧文件并收敛范围', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'edt-skill-settings-')), 'settings.json')
  await writeFile(path, JSON.stringify({ autoReDisable: true, trashRetentionDays: 7 }), 'utf8')
  const settings = normalizeSkillManagerSettings({ autoReDisable: true, trashRetentionDays: 7 })
  assert.equal(settings.defaultUpdatePolicy, 'safe')
  assert.equal(settings.autoCheckIntervalHours, 24)
  assert.equal(settings.removePolicy, 'trash')
  assert.equal(settings.networkTimeoutMs, 15_000)
  const clamped = normalizeSkillManagerSettings({ autoCheckIntervalHours: 999, networkTimeoutMs: 1 })
  assert.equal(clamped.autoCheckIntervalHours, 168)
  assert.equal(clamped.networkTimeoutMs, 3_000)
})
