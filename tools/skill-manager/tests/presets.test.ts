/* eslint-disable test/no-import-node-test -- node:test keeps this suite runnable without vitest. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { skillOriginKey } from '../../../shared/skill-manager.ts'
import { emptyFavorites, readFavorites, setFavorite, writeFavorites } from '../backend/services/favorites.ts'
import { applyPresetCore } from '../backend/services/preset-apply-core.ts'
import { emptyPresets, readPresets, savePreset, writePresets } from '../backend/services/presets.ts'
import { normalizeProjectPath } from '../backend/services/projects.ts'

const SOURCE = `---
name: alpha
description: Alpha skill
---
# Alpha
`
const BETA = `---
name: beta
description: Beta skill
---
# Beta
`

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'skill-manager-preset-'))
  const source = join(root, 'source')
  const project = join(root, 'project-a')
  const projectB = join(root, 'project-b')
  await mkdir(join(source, 'alpha'), { recursive: true })
  await mkdir(join(source, 'beta'), { recursive: true })
  await mkdir(project, { recursive: true })
  await mkdir(projectB, { recursive: true })
  await writeFile(join(source, 'alpha', 'SKILL.md'), SOURCE)
  await writeFile(join(source, 'beta', 'SKILL.md'), BETA)
  const origin = (name: string) => ({
    sourceType: 'local' as const,
    source,
    ref: null,
    skillPath: `${name}/SKILL.md`,
  })
  return { root, source, project, projectB, origin }
}

async function paths(root: string, project: string) {
  const { realpath } = await import('node:fs/promises')
  const projectPath = await realpath(project)
  return {
    kind: 'project' as const,
    scopeId: `project:${projectPath}`,
    projectPath,
    skillsDir: join(projectPath, '.agents', 'skills'),
    lockPath: join(projectPath, 'skills-lock.json'),
    registryPath: join(root, 'config', 'registry.json'),
    historyPath: join(root, 'config', 'history.json'),
    trashRoot: join(root, 'assets', 'trash'),
    stagingRoot: join(root, 'cache', 'staging'),
    backupRoot: join(root, 'config', 'lock-backups'),
  }
}

test('favorites keep per-skill origin keys and categories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-manager-favorite-'))
  const path = join(root, 'favorites.json')
  const file = emptyFavorites()
  const origin = { sourceType: 'github' as const, source: 'acme/skills', ref: null, skillPath: 'skills/a/SKILL.md' }
  setFavorite(file, origin, 'alpha', true, ['engineering'])
  assert.equal(skillOriginKey(origin), 'github:acme/skills#skills/a/SKILL.md')
  assert.equal(Object.keys(file.items).length, 1)
  writeFavorites(file, path)
  assert.equal(readFavorites(path).items[skillOriginKey(origin)].categories[0], 'engineering')
  await rm(root, { recursive: true, force: true })
})

test('preset JSON roundtrip and import validation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-manager-preset-json-'))
  const path = join(root, 'presets.json')
  const file = emptyPresets()
  const origin = { sourceType: 'local' as const, source: '/tmp/source', ref: null, skillPath: 'alpha/SKILL.md' }
  const preset = savePreset(file, {
    name: 'Alpha',
    items: [{ key: skillOriginKey(origin), name: 'alpha', origin, installName: 'alpha', enabled: true }],
  })
  writePresets(file, path)
  assert.equal(readPresets(path).presets[preset.id].items.length, 1)
  assert.throws(() => JSON.parse('{'), SyntaxError)
  await rm(root, { recursive: true, force: true })
})

test('preset apply installs, updates, keeps extras in additive and removes in exact', async () => {
  const { root, project, projectB, origin } = await fixture()
  const alpha = { key: skillOriginKey(origin('alpha')), name: 'alpha', origin: origin('alpha'), installName: 'alpha', enabled: true }
  const beta = { key: skillOriginKey(origin('beta')), name: 'beta', origin: origin('beta'), installName: 'beta', enabled: true }
  const preset = {
    id: 'preset-1',
    name: 'Alpha',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdFrom: 'manual',
    defaultTarget: { kind: 'project' as const },
    applyMode: 'additive' as const,
    installMode: 'copy' as const,
    items: [alpha],
  }
  const first = await applyPresetCore({ presetId: preset.id, target: { kind: 'project', path: project } }, preset, await paths(root, project))
  assert.deepEqual(first.installed, ['alpha'])
  assert.equal(JSON.parse(await readFile(join(project, 'skills-lock.json'), 'utf8')).skills.alpha.sourceType, 'local')

  const full = { ...preset, items: [alpha, beta] }
  const second = await applyPresetCore({ presetId: full.id, target: { kind: 'project', path: project } }, full, await paths(root, project))
  assert.deepEqual(second.installed, ['beta'])
  const exact = await applyPresetCore({ presetId: preset.id, target: { kind: 'project', path: project }, mode: 'exact' }, preset, await paths(root, project))
  assert.deepEqual(exact.removed, ['beta'])
  const lock = JSON.parse(await readFile(join(project, 'skills-lock.json'), 'utf8'))
  assert.deepEqual(Object.keys(lock.skills), ['alpha'])

  const other = await applyPresetCore({ presetId: full.id, target: { kind: 'project', path: projectB } }, full, await paths(root, projectB))
  assert.deepEqual(other.installed.sort(), ['alpha', 'beta'])
  await rm(root, { recursive: true, force: true })
})

test('rejects filesystem root and home as preset custom target', async () => {
  await assert.rejects(() => normalizeProjectPath('/'), /根目录/)
  await assert.rejects(() => normalizeProjectPath(homedir()), /主目录/)
})
