/* eslint-disable test/no-import-node-test */
import type { Scope, SkillManagerRecord } from '../../../shared/skill-manager.ts'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readProjectLock } from '../backend/locks/project-lock.ts'
import { adoptSkillCore } from '../backend/services/adopt-core.ts'
import { hashSkillDirectory } from '../backend/services/hash.ts'
import { createUpdatePlanCore } from '../backend/services/planner-core.ts'
import { readSkillManagerRegistry, writeSkillManagerRegistry } from '../backend/services/registry.ts'
import { forgetRemovedCore, reinstallRemovedCore } from '../backend/services/removed-core.ts'
import { scanScope } from '../backend/services/scanner.ts'

async function makeSkill(root: string, name: string, content = 'hello'): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n${content}\n`)
  return dir
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'skill-manager-adopt-'))
  const projectPath = join(root, 'project')
  const skillsDir = join(projectPath, '.agents', 'skills')
  await mkdir(skillsDir, { recursive: true })
  const scope: Scope = {
    id: 'project:test',
    kind: 'project',
    label: 'project',
    skillsDir,
    lockPath: join(projectPath, 'skills-lock.json'),
    projectPath,
    lockState: 'missing',
    lockVersion: 1,
  }
  const paths = {
    registryPath: join(root, 'registry.json'),
    historyPath: join(root, 'history.json'),
    backupRoot: join(root, 'backups'),
  }
  return { root, projectPath, skillsDir, scope, paths }
}

test('source adoption writes project lock + baseline and keeps the directory', async () => {
  const f = await fixture()
  const target = await makeSkill(f.skillsDir, 'foo')
  const upstream = await makeSkill(join(f.root, 'sources'), 'foo')
  const result = await adoptSkillCore({ scopeId: f.scope.id, name: 'foo', mode: 'source', input: upstream }, f.scope, f.paths)
  assert.equal(result.lockManaged, true)
  const lock = await readProjectLock(f.projectPath)
  assert.equal(lock.ok, true)
  assert.equal(lock.ok && lock.data.skills.foo?.source, '../sources/foo')
  assert.equal(lock.ok && lock.data.skills.foo?.computedHash, await hashSkillDirectory(target))
  const registry = readSkillManagerRegistry(f.paths.registryPath)
  assert.equal(registry.scopes[f.scope.id]?.records.foo?.lockManaged, true)
  assert.equal(registry.scopes[f.scope.id]?.records.foo?.baseline.contentHash, await hashSkillDirectory(target))
  assert.deepEqual(registry.scopes[f.scope.id]?.records.foo?.origin.sourceType, 'local')
  assert.equal((await readFile(join(target, 'SKILL.md'), 'utf8')).includes('hello'), true)
})

test('local adoption does not write a lock and is marked lockManaged false', async () => {
  const f = await fixture()
  const target = await makeSkill(f.skillsDir, 'bar')
  const result = await adoptSkillCore({ scopeId: f.scope.id, name: 'bar', mode: 'local' }, f.scope, f.paths)
  assert.equal(result.lockManaged, false)
  const lock = await readProjectLock(f.projectPath)
  assert.equal(lock.ok, true)
  assert.deepEqual(lock.ok && lock.data.skills, {})
  const registry = readSkillManagerRegistry(f.paths.registryPath)
  assert.equal(registry.scopes[f.scope.id]?.records.bar?.lockManaged, false)
  assert.equal(registry.scopes[f.scope.id]?.records.bar?.origin.source, target)
  assert.equal((await readFile(join(target, 'SKILL.md'), 'utf8')).includes('hello'), true)
})

test('orphan delete moves the directory to trash and leaves a removable tombstone', async () => {
  const f = await fixture()
  const target = await makeSkill(f.skillsDir, 'orphan')
  const skill = {
    key: 'orphan',
    name: 'orphan',
    dirName: 'orphan',
    scopeId: f.scope.id,
    origin: { sourceType: 'unknown' as const, source: '', ref: null, skillPath: 'SKILL.md' },
    state: 'orphan' as const,
    stateReasons: [],
    installMode: 'copy' as const,
    localModified: false,
    disabled: false,
    tracked: false,
    forked: false,
  }
  const { deleteSkillCore } = await import('../backend/services/delete-skill-core.ts')
  const result = await deleteSkillCore({ scopeId: f.scope.id, name: 'orphan' }, f.scope, skill, {
    trashRoot: join(f.root, 'trash'),
    registryPath: f.paths.registryPath,
    historyPath: f.paths.historyPath,
  })
  assert.equal(result.name, 'orphan')
  assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8').then(() => true).catch(() => false), false)
  const registry = readSkillManagerRegistry(f.paths.registryPath)
  assert.equal(registry.scopes[f.scope.id]?.records.orphan?.state, 'removed')
  assert.equal(registry.scopes[f.scope.id]?.records.orphan?.removedReason, 'uninstall')
  assert.equal(registry.scopes[f.scope.id]?.records.orphan?.trashRef, result.operationId)
})

test('removed views include tombstones and external deletions, sorted by time', async () => {
  const { buildRemovedViews } = await import('../backend/services/removed-views.ts')
  const now = '2026-01-02T00:00:00.000Z'
  const base = {
    dirName: 'foo',
    origin: { sourceType: 'github' as const, source: 'owner/repo', ref: 'main', skillPath: 'skills/foo/SKILL.md' },
    installMode: 'copy' as const,
    baseline: { contentHash: 'abc', capturedAt: now, source: 'install' as const },
    remote: { fetchedAt: now },
    tracked: true,
    forked: false,
    state: 'removed' as const,
    installedAt: now,
    updatedAt: now,
  }
  const views = buildRemovedViews('global', {
    foo: { ...base, name: 'foo', removedAt: now, removedReason: 'uninstall', trashRef: 'op1' },
    bar: { ...base, name: 'bar', state: 'installed', updatedAt: '2026-01-03T00:00:00.000Z' },
    active: { ...base, name: 'active', state: 'installed' },
  }, new Set(['active']))
  assert.equal(views.length, 2)
  assert.equal(views[0]?.name, 'bar')
  assert.equal(views[0]?.removedReason, 'external')
  assert.equal(views[1]?.name, 'foo')
  assert.equal(views[1]?.trashRef, 'op1')
})

test('tombstone reinstall restores the lock and forget removes the record', async () => {
  const f = await fixture()
  const upstream = await makeSkill(join(f.root, 'sources'), 'alpha')
  const now = new Date().toISOString()
  const record: SkillManagerRecord = {
    name: 'alpha',
    dirName: 'alpha',
    origin: { sourceType: 'local', source: upstream, ref: null, skillPath: 'SKILL.md' },
    installMode: 'copy',
    baseline: { contentHash: 'gone', capturedAt: now, source: 'install' },
    remote: { fetchedAt: now },
    tracked: true,
    forked: false,
    state: 'removed',
    installedAt: now,
    updatedAt: now,
    removedAt: now,
    removedReason: 'uninstall',
    trashRef: 'op-gone',
  }
  writeSkillManagerRegistry({
    version: 1,
    scopes: {
      [f.scope.id]: {
        scopeId: f.scope.id,
        lastScanAt: now,
        lockFingerprint: null,
        records: { alpha: record },
      },
    },
    groups: {},
  }, f.paths.registryPath)

  const projectPaths = {
    projectPath: f.projectPath,
    skillsDir: f.skillsDir,
    lockPath: join(f.projectPath, 'skills-lock.json'),
    trashRoot: join(f.root, 'trash'),
    registryPath: f.paths.registryPath,
    historyPath: f.paths.historyPath,
    stagingRoot: join(f.root, 'staging'),
    backupRoot: f.paths.backupRoot,
  }
  const result = await reinstallRemovedCore('alpha', record, f.scope, {
    registryPath: f.paths.registryPath,
    global: projectPaths,
    project: () => projectPaths,
  })
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.installed, ['alpha'])
  const lock = await readProjectLock(f.projectPath)
  assert.equal(lock.ok && lock.data.skills.alpha?.source, '../sources/alpha')
  assert.equal(await readFile(join(f.skillsDir, 'alpha', 'SKILL.md'), 'utf8').then(text => text.includes('hello')), true)

  forgetRemovedCore(f.scope.id, 'alpha', f.paths.registryPath)
  assert.equal(readSkillManagerRegistry(f.paths.registryPath).scopes[f.scope.id]?.records.alpha, undefined)
})

test('source-adopted skill participates in update planning', async () => {
  const f = await fixture()
  await makeSkill(f.skillsDir, 'foo')
  const upstream = await makeSkill(join(f.root, 'sources'), 'foo')
  await adoptSkillCore({ scopeId: f.scope.id, name: 'foo', mode: 'source', input: upstream }, f.scope, f.paths)
  const groupKey = (await scanScope(f.scope)).groups[0]!.key
  await writeFile(join(upstream, 'SKILL.md'), '---\nname: foo\ndescription: changed\n---\nchanged\n')
  const plan = await createUpdatePlanCore({ scopeId: f.scope.id, groupKey }, {
    skillsDir: f.skillsDir,
    lockPath: join(f.projectPath, 'skills-lock.json'),
    trashRoot: join(f.root, 'trash'),
    registryPath: f.paths.registryPath,
    historyPath: f.paths.historyPath,
    stagingRoot: join(f.root, 'staging'),
    backupRoot: f.paths.backupRoot,
    projectPath: f.projectPath,
  })
  assert.equal(plan.items.find(item => item.name === 'foo')?.action, 'update')
})
