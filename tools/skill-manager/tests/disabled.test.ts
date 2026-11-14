/* eslint-disable test/no-import-node-test */
import type { Scope } from '../../../shared/skill-manager.ts'
import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { writeGlobalLock } from '../backend/locks/global-lock.ts'
import { readProjectLock, writeProjectLock } from '../backend/locks/project-lock.ts'
import { getDisabledIndexPath, writeDisabledIndex } from '../backend/services/disabled-index.ts'
import { setEnabledCore } from '../backend/services/disabled.ts'
import { createTrashSession, moveToTrash } from '../backend/services/executor.ts'
import { hashSkillDirectory } from '../backend/services/hash.ts'
import { readSkillManagerHistory } from '../backend/services/history.ts'
import { readSkillManagerRegistry } from '../backend/services/registry.ts'
import { DEFAULT_SKILL_MANAGER_SETTINGS } from '../backend/services/settings.ts'
import { cleanupTrash, listTrash, restoreTrashItem } from '../backend/services/trash.ts'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'skill-manager-disabled-'))
}

async function makeSkill(root: string, name: string, content = 'hello'): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n${content}\n`)
  return dir
}

async function paths(root: string) {
  return {
    disabledRoot: join(root, 'disabled'),
    registryPath: join(root, 'registry.json'),
    historyPath: join(root, 'history.json'),
    backupRoot: join(root, 'backups'),
    trashRoot: join(root, 'trash'),
  }
}

function globalScope(root: string): Scope {
  return {
    id: 'global',
    kind: 'global',
    label: '全局',
    skillsDir: join(root, 'skills'),
    lockPath: join(root, '.skill-lock.json'),
    lockState: 'ok',
    lockVersion: 3,
  }
}

test('global disable moves out of scan root and enable restores lock + content', async () => {
  const root = await tempRoot()
  const scope = globalScope(root)
  const p = await paths(root)
  await mkdir(scope.skillsDir, { recursive: true })
  const source = await makeSkill(scope.skillsDir, 'foo')
  const before = await hashSkillDirectory(source)
  await writeGlobalLock({
    version: 3,
    skills: {
      foo: {
        source: 'owner/repo',
        sourceType: 'github',
        skillPath: 'skills/foo/SKILL.md',
        skillFolderHash: 'old',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        installMode: 'copy',
      },
    },
  }, scope.lockPath)

  const disabled = await setEnabledCore({ scopeId: 'global', names: ['foo'], enabled: false }, scope, p)
  assert.deepEqual(disabled.disabled, ['foo'])
  assert.equal(await lstat(source).then(() => true).catch(() => false), false)
  assert.equal((await lstat(join(p.disabledRoot, 'global', 'foo'))).isDirectory(), true)
  const lockAfterDisable = JSON.parse(await readFile(scope.lockPath, 'utf8'))
  assert.deepEqual(Object.keys(lockAfterDisable.skills), [])
  const index = JSON.parse(await readFile(join(p.disabledRoot, 'global', 'index.json'), 'utf8'))
  assert.equal(index.entries.foo.installMode, 'copy')
  assert.equal(index.entries.foo.lockEntry.skillPath, 'skills/foo/SKILL.md')
  const registry = readSkillManagerRegistry(p.registryPath)
  assert.deepEqual(registry.groups['global|github:owner/repo@'].disabledNames, ['foo'])

  const enabled = await setEnabledCore({ scopeId: 'global', names: ['foo'], enabled: true }, scope, p)
  assert.deepEqual(enabled.enabled, ['foo'])
  assert.equal(await hashSkillDirectory(source), before)
  const lockAfterEnable = JSON.parse(await readFile(scope.lockPath, 'utf8'))
  assert.equal(lockAfterEnable.skills.foo.skillPath, 'skills/foo/SKILL.md')
  assert.equal(lockAfterEnable.skills.foo.skillFolderHash, before)
  const indexAfterEnable = JSON.parse(await readFile(join(p.disabledRoot, 'global', 'index.json'), 'utf8'))
  assert.deepEqual(Object.keys(indexAfterEnable.entries), [])
  assert.deepEqual(readSkillManagerRegistry(p.registryPath).groups['global|github:owner/repo@'].disabledNames, [])
  const history = readSkillManagerHistory(p.historyPath)
  assert.deepEqual(history.entries.map(entry => entry.action), ['enable', 'disable'])
})

test('disabled drift keeps the disabled copy and moves the reappeared directory to trash', async () => {
  const root = await tempRoot()
  const scope = globalScope(root)
  const p = await paths(root)
  await mkdir(scope.skillsDir, { recursive: true })
  await makeSkill(scope.skillsDir, 'drift')
  await writeGlobalLock({ version: 3, skills: { drift: {
    source: 'owner/repo',
    sourceType: 'github',
    skillPath: 'skills/drift/SKILL.md',
    skillFolderHash: 'hash',
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } } }, scope.lockPath)

  await setEnabledCore({ scopeId: 'global', names: ['drift'], enabled: false }, scope, p)
  await makeSkill(scope.skillsDir, 'drift', 'reappeared')
  const resolved = await setEnabledCore({ scopeId: 'global', names: ['drift'], enabled: false }, scope, p)
  assert.deepEqual(resolved.disabled, ['drift'])
  assert.equal(await lstat(join(scope.skillsDir, 'drift')).then(() => true).catch(() => false), false)
  assert.equal(await lstat(join(p.disabledRoot, 'global', 'drift')).then(() => true).catch(() => false), true)
  const index = JSON.parse(await readFile(join(p.disabledRoot, 'global', 'index.json'), 'utf8'))
  assert.deepEqual(Object.keys(index.entries), ['drift'])
  const trashed = await listTrash(join(root, 'trash'))
  assert.equal(trashed.items.some(item => item.name === 'drift' && item.reason === 'disabled-drift'), true)
})

test('symlink disable only unlinks the skill and enable recreates the link', async () => {
  const root = await tempRoot()
  const scope = globalScope(root)
  const p = await paths(root)
  await mkdir(scope.skillsDir, { recursive: true })
  const target = await makeSkill(root, 'target-bar')
  const link = join(scope.skillsDir, 'bar')
  await symlink(target, link, 'dir')
  await writeGlobalLock({ version: 3, skills: { bar: {
    source: 'owner/repo',
    sourceType: 'github',
    skillPath: 'skills/bar/SKILL.md',
    skillFolderHash: 'hash',
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } } }, scope.lockPath)

  await setEnabledCore({ scopeId: 'global', names: ['bar'], enabled: false }, scope, p)
  assert.equal(await lstat(link).then(() => true).catch(() => false), false)
  assert.equal((await lstat(target)).isDirectory(), true)
  const index = JSON.parse(await readFile(join(p.disabledRoot, 'global', 'index.json'), 'utf8'))
  assert.equal(index.entries.bar.installMode, 'symlink')
  assert.equal(index.entries.bar.linkTarget, target)

  await setEnabledCore({ scopeId: 'global', names: ['bar'], enabled: true }, scope, p)
  assert.equal((await lstat(link)).isSymbolicLink(), true)
  assert.equal(await readlink(link), target)
})

test('project disable keeps the lock entry and enable returns the directory', async () => {
  const root = await tempRoot()
  const projectPath = join(root, 'project')
  const scope: Scope = {
    id: 'project:test',
    kind: 'project',
    label: 'project',
    skillsDir: join(projectPath, '.agents', 'skills'),
    lockPath: join(projectPath, 'skills-lock.json'),
    projectPath,
    lockState: 'ok',
    lockVersion: 1,
  }
  const p = await paths(root)
  await mkdir(scope.skillsDir, { recursive: true })
  await makeSkill(scope.skillsDir, 'pfoo')
  await writeProjectLock({
    version: 1,
    skills: { pfoo: { source: '../src', sourceType: 'local', computedHash: 'old', installMode: 'copy' } },
  }, projectPath, { operationId: 'init', backupRoot: p.backupRoot })

  await setEnabledCore({ scopeId: scope.id, names: ['pfoo'], enabled: false }, scope, p)
  const retained = await readProjectLock(projectPath)
  assert.equal(retained.ok, true)
  assert.ok(retained.ok && retained.data.skills.pfoo)

  await setEnabledCore({ scopeId: scope.id, names: ['pfoo'], enabled: true }, scope, p)
  assert.equal((await lstat(join(scope.skillsDir, 'pfoo'))).isDirectory(), true)
  const restored = await readProjectLock(projectPath)
  assert.ok(restored.ok && restored.data.skills.pfoo.computedHash !== 'old')
})

test('batch disable rollback restores the first moved directory without deleting it', async () => {
  const root = await tempRoot()
  const scope = globalScope(root)
  const p = await paths(root)
  await mkdir(scope.skillsDir, { recursive: true })
  const first = await makeSkill(scope.skillsDir, 'first', 'first-content')
  await makeSkill(scope.skillsDir, 'second')
  await mkdir(join(p.disabledRoot, 'global', 'second'), { recursive: true })
  await writeGlobalLock({
    version: 3,
    skills: {
      first: {
        source: 'owner/repo',
        sourceType: 'github',
        skillFolderHash: 'h1',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      second: {
        source: 'owner/repo',
        sourceType: 'github',
        skillFolderHash: 'h2',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  }, scope.lockPath)

  await assert.rejects(
    setEnabledCore({ scopeId: 'global', names: ['first', 'second'], enabled: false }, scope, p),
    /禁用目标已存在：second/,
  )
  assert.equal(await lstat(join(p.disabledRoot, 'global', 'first')).then(() => true).catch(() => false), false)
  assert.equal((await lstat(first)).isDirectory(), true)
  assert.match(await readFile(join(first, 'SKILL.md'), 'utf8'), /first-content/)
  assert.deepEqual(JSON.parse(await readFile(scope.lockPath, 'utf8')).skills.first.skillFolderHash, 'h1')
})

test('batch enable rollback returns the first restored directory to the disabled area', async () => {
  const root = await tempRoot()
  const scope = globalScope(root)
  const p = await paths(root)
  await mkdir(scope.skillsDir, { recursive: true })
  await makeSkill(scope.skillsDir, 'first', 'first-content')
  await makeSkill(scope.skillsDir, 'second')
  await writeGlobalLock({
    version: 3,
    skills: {
      first: {
        source: 'owner/repo',
        sourceType: 'github',
        skillFolderHash: 'h1',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      second: {
        source: 'owner/repo',
        sourceType: 'github',
        skillFolderHash: 'h2',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  }, scope.lockPath)

  await setEnabledCore({ scopeId: 'global', names: ['first', 'second'], enabled: false }, scope, p)
  await makeSkill(scope.skillsDir, 'second', 'occupied')
  await assert.rejects(
    setEnabledCore({ scopeId: 'global', names: ['first', 'second'], enabled: true }, scope, p),
    /启用目标已存在：second/,
  )
  assert.equal(await lstat(join(scope.skillsDir, 'first')).then(() => true).catch(() => false), false)
  assert.equal((await lstat(join(p.disabledRoot, 'global', 'first'))).isDirectory(), true)
  assert.match(await readFile(join(p.disabledRoot, 'global', 'first', 'SKILL.md'), 'utf8'), /first-content/)
})

test('failed transaction does not leave empty lock/registry when they did not exist', async () => {
  const root = await tempRoot()
  const scope = globalScope(root)
  const p = await paths(root)
  // 历史文件位置是目录：事务在最后一步必然失败，触发一次“写完之后”的回滚
  p.historyPath = join(root, 'history-as-directory')
  await mkdir(p.historyPath, { recursive: true })
  await mkdir(scope.skillsDir, { recursive: true })

  const disabledDir = join(p.disabledRoot, 'global', 'bar')
  await mkdir(disabledDir, { recursive: true })
  await writeFile(join(disabledDir, 'SKILL.md'), '---\nname: bar\ndescription: test\n---\nbody\n')
  const contentHash = await hashSkillDirectory(disabledDir)
  await writeDisabledIndex({
    version: 1,
    scopeId: 'global',
    entries: {
      bar: {
        name: 'bar',
        scopeId: 'global',
        groupKey: 'global|github:owner/repo@',
        origin: { sourceType: 'github', source: 'owner/repo', ref: null, skillPath: 'skills/bar/SKILL.md' },
        installMode: 'copy',
        contentHash,
        disabledAt: new Date().toISOString(),
      },
    },
  }, p.disabledRoot)

  await assert.rejects(
    setEnabledCore({ scopeId: 'global', names: ['bar'], enabled: true }, scope, p),
  )
  assert.equal(await lstat(scope.lockPath).then(() => true).catch(() => false), false)
  assert.equal(await lstat(p.registryPath).then(() => true).catch(() => false), false)
  assert.equal((await lstat(disabledDir)).isDirectory(), true)
  const index = JSON.parse(await readFile(getDisabledIndexPath(p.disabledRoot, 'global'), 'utf8'))
  assert.deepEqual(Object.keys(index.entries), ['bar'])
})

test('trash list/restore keeps the directory and removes the manifest entry', async () => {
  const root = await tempRoot()
  const trashRoot = join(root, 'trash')
  const source = await makeSkill(root, 'trashed')
  const session = createTrashSession(trashRoot, 'op1', 'global', 'test')
  await moveToTrash(session, source, 'trashed')
  const listed = await listTrash(trashRoot, DEFAULT_SKILL_MANAGER_SETTINGS)
  assert.equal(listed.items.length, 1)
  assert.ok(listed.items[0].sizeBytes > 0)

  const restored = await restoreTrashItem(trashRoot, 'op1', 'trashed')
  assert.equal(restored.restored, true)
  assert.equal((await lstat(source)).isDirectory(), true)
  assert.equal((await listTrash(trashRoot)).items.length, 0)
})

test('trash cleanup removes entries older than retention', async () => {
  const root = await tempRoot()
  const trashRoot = join(root, 'trash')
  const source = await makeSkill(root, 'old')
  const session = createTrashSession(trashRoot, 'op-old', 'global', 'test')
  await moveToTrash(session, source, 'old')
  const manifestPath = join(trashRoot, 'op-old', 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.createdAt = '2020-01-01T00:00:00.000Z'
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const result = await cleanupTrash(trashRoot, { ...DEFAULT_SKILL_MANAGER_SETTINGS, trashRetentionDays: 30 })
  assert.equal(result.removed, 1)
  assert.equal((await listTrash(trashRoot)).items.length, 0)
})
