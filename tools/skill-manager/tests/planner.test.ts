/* eslint-disable test/no-import-node-test */
import type { ProjectLockFile, Scope } from '../../shared/skill-manager.ts'
import type { PlanPaths } from '../backend/services/planner-core.ts'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readProjectLock } from '../backend/locks/project-lock.ts'
import { hashSkillDirectory } from '../backend/services/hash.ts'
import { applyUpdatePlanCore, createUpdatePlanCore, undoPlanCore } from '../backend/services/planner-core.ts'

async function writeSkill(root: string, name: string, body: string): Promise<void> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${body}\n---\n\n${body}\n`, 'utf8')
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sm-planner-'))
  const project = join(root, 'project')
  const source = join(root, 'source')
  const skills = join(project, '.agents', 'skills')
  await mkdir(skills, { recursive: true })

  await writeSkill(source, 'keep', 'keep-v1')
  await writeSkill(source, 'change-me', 'change-v2')
  await writeSkill(skills, 'keep', 'keep-v1')
  await writeSkill(skills, 'change-me', 'change-v1')
  await writeSkill(skills, 'remove-me', 'remove-v1')

  const entries: ProjectLockFile['skills'] = {}
  for (const name of ['keep', 'change-me', 'remove-me']) {
    entries[name] = {
      source,
      sourceType: 'local',
      skillPath: `${name}/SKILL.md`,
      computedHash: await hashSkillDirectory(join(skills, name)),
      custom: 'keep-this',
    }
  }
  const lock: ProjectLockFile = { version: 1, generatedBy: 'planner-test', skills: entries }
  await writeFile(join(project, 'skills-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8')

  const paths: PlanPaths = {
    projectPath: project,
    skillsDir: skills,
    lockPath: join(project, 'skills-lock.json'),
    trashRoot: join(root, 'trash'),
    registryPath: join(root, 'registry.json'),
    historyPath: join(root, 'history.json'),
    stagingRoot: join(root, 'staging'),
    backupRoot: join(root, 'lock-backups'),
  }
  const scope: Scope = {
    id: 'project:planner-test',
    kind: 'project',
    label: 'project',
    skillsDir: skills,
    lockPath: paths.lockPath,
    projectPath: project,
    lockState: 'ok',
  }
  return { root, project, source, skills, paths, scope }
}

test('planner detects update/remove and preserves local skip', async () => {
  const f = await fixture()
  try {
    const plan = await createUpdatePlanCore({
      scopeId: f.scope.id,
      groupKey: `local:${f.source}@`,
    }, f.paths)
    assert.equal(plan.summary.update, 1)
    assert.equal(plan.summary.remove, 1)
    assert.equal(plan.summary.skip, 1)
    const byName = Object.fromEntries(plan.items.map(item => [item.name, item]))
    assert.equal(byName['change-me'].action, 'update')
    assert.equal(byName['change-me'].selectedByDefault, true)
    assert.equal(byName['remove-me'].action, 'remove')
    assert.equal(byName['remove-me'].selectedByDefault, true)
    assert.equal(byName.keep.action, 'skip')
  }
  finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('apply plan updates/removes and undo restores lock and directories', async () => {
  const f = await fixture()
  try {
    const beforeRaw = await readFile(f.paths.lockPath, 'utf8')
    const plan = await createUpdatePlanCore({
      scopeId: f.scope.id,
      groupKey: `local:${f.source}@`,
    }, f.paths)
    const names = plan.items.filter(item => item.selectedByDefault).map(item => item.name).sort()
    const result = await applyUpdatePlanCore({ planId: plan.id, names }, f.paths)
    assert.deepEqual(result.updated, ['change-me'])
    assert.deepEqual(result.removed, ['remove-me'])

    const after = await readProjectLock(f.project)
    assert.equal(after.ok, true)
    if (!after.ok) return
    assert.equal(Object.hasOwn(after.data.skills, 'remove-me'), false)
    assert.equal(after.data.skills['change-me'].computedHash, await hashSkillDirectory(join(f.skills, 'change-me')))
    assert.equal(after.data.skills['change-me'].custom, 'keep-this')
    assert.equal((after.data as Record<string, unknown>).generatedBy, 'planner-test')
    assert.match(await readFile(join(f.skills, 'change-me', 'SKILL.md'), 'utf8'), /change-v2/)

    const history = JSON.parse(await readFile(f.paths.historyPath, 'utf8')) as { entries: Array<Record<string, unknown>> }
    assert.equal(history.entries[0].planId, plan.id)
    assert.ok(history.entries[0].trashEntries)

    const undo = await undoPlanCore({ scopeId: f.scope.id }, f.paths)
    assert.deepEqual(undo.restored.sort(), ['change-me', 'remove-me'])
    assert.match(await readFile(join(f.skills, 'change-me', 'SKILL.md'), 'utf8'), /change-v1/)
    assert.match(await readFile(join(f.skills, 'remove-me', 'SKILL.md'), 'utf8'), /remove-v1/)
    const restored = await readProjectLock(f.project)
    assert.equal(restored.ok, true)
    if (!restored.ok) return
    assert.equal(Object.hasOwn(restored.data.skills, 'remove-me'), true)
    assert.equal(restored.data.skills['change-me'].computedHash, await hashSkillDirectory(join(f.skills, 'change-me')))
    assert.equal(await readFile(f.paths.lockPath, 'utf8'), beforeRaw)
  }
  finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('unreachable source never becomes a remove plan', async () => {
  const f = await fixture()
  try {
    await rm(f.source, { recursive: true, force: true })
    await assert.rejects(
      createUpdatePlanCore({ scopeId: f.scope.id, groupKey: `local:${f.source}@` }, f.paths),
      /本地目录不存在|source|not-found/i,
    )
  }
  finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('removePolicy=keep：移除锁记录但保留目录', async () => {
  const f = await fixture()
  try {
    const paths = { ...f.paths, removePolicy: 'keep' as const }
    const plan = await createUpdatePlanCore({
      scopeId: f.scope.id,
      groupKey: `local:${f.source}@`,
    }, paths)
    const result = await applyUpdatePlanCore({ planId: plan.id, names: ['remove-me'] }, paths)
    assert.deepEqual(result.applied, ['remove-me'])
    assert.deepEqual(result.removed, ['remove-me'])
    const lock = await readProjectLock(f.project)
    assert.equal(lock.ok, true)
    if (!lock.ok) return
    assert.equal(lock.data.skills['remove-me'], undefined)
    assert.equal(await readFile(join(f.skills, 'remove-me', 'SKILL.md'), 'utf8').then(value => value.includes('remove-me')), true)
  }
  finally {
    await rm(f.root, { recursive: true, force: true })
  }
})
