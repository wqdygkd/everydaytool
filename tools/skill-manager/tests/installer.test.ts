/* eslint-disable test/no-import-node-test */
import type { InstallPaths } from '../backend/services/installer-core.ts'
import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { restoreTrashEntry } from '../backend/services/executor.ts'
import { installSkillsCore } from '../backend/services/installer-core.ts'

let root = ''
let paths: InstallPaths

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'edt-skill-installer-'))
  paths = {
    skillsDir: join(root, 'global', 'skills'),
    lockPath: join(root, 'global', '.skill-lock.json'),
    trashRoot: join(root, 'trash'),
    registryPath: join(root, 'config', 'registry.json'),
    historyPath: join(root, 'config', 'history.json'),
    stagingRoot: join(root, 'cache', 'staging'),
  }
})

after(async () => {
  await rm(root, { recursive: true, force: true })
})

async function makeSource(name: string, body = 'demo'): Promise<string> {
  const source = join(root, 'sources', name)
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'SKILL.md'), `---\nname: ${name}\ndescription: ${body}\n---\n\n# ${name}\n`, 'utf8')
  await writeFile(join(source, 'note.txt'), body, 'utf8')
  return source
}

test('installs a local skill, updates same source, blocks different source', async () => {
  const source = await makeSource('demo')
  const first = await installSkillsCore({ input: source, names: ['demo'] }, paths)
  assert.equal(first.status, 'ok')
  assert.deepEqual(first.installed, ['demo'])
  assert.equal(await readFile(join(paths.skillsDir, 'demo', 'note.txt'), 'utf8'), 'demo')

  const lock = JSON.parse(await readFile(paths.lockPath, 'utf8')) as { version: number, skills: Record<string, { installedAt: string, source: string }> }
  assert.equal(lock.version, 3)
  assert.equal(lock.skills.demo.source, source)
  const installedAt = lock.skills.demo.installedAt

  await writeFile(join(source, 'note.txt'), 'updated', 'utf8')
  const second = await installSkillsCore({ input: source, names: ['demo'] }, paths)
  assert.equal(second.status, 'ok')
  assert.deepEqual(second.updated, ['demo'])
  assert.ok(second.trashRef)
  assert.equal(await readFile(join(paths.skillsDir, 'demo', 'note.txt'), 'utf8'), 'updated')
  const afterUpdate = JSON.parse(await readFile(paths.lockPath, 'utf8')) as { skills: Record<string, { installedAt: string }> }
  assert.equal(afterUpdate.skills.demo.installedAt, installedAt)

  await mkdir(join(root, 'sources', 'other', 'demo'), { recursive: true })
  await writeFile(join(root, 'sources', 'other', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: other\n---\n', 'utf8')
  const conflict = await installSkillsCore({ input: join(root, 'sources', 'other', 'demo'), names: ['demo'] }, paths)
  assert.equal(conflict.status, 'conflict')
  assert.equal(conflict.conflicts[0]?.reason, 'different-source')
  assert.equal(await readFile(join(paths.skillsDir, 'demo', 'note.txt'), 'utf8'), 'updated')

  const registry = JSON.parse(await readFile(paths.registryPath, 'utf8')) as { scopes: { global: { records: Record<string, { state: string }> } } }
  assert.equal(registry.scopes.global.records.demo.state, 'installed')
  const history = JSON.parse(await readFile(paths.historyPath, 'utf8')) as { entries: { action: string }[] }
  assert.equal(history.entries[0]?.action, 'update')
})

test('moves the previous version to trash and can restore it', async () => {
  const source = await makeSource('restore')
  const first = await installSkillsCore({ input: source, names: ['restore'] }, paths)
  assert.equal(first.status, 'ok')
  const target = join(paths.skillsDir, 'restore')
  await writeFile(join(target, 'note.txt'), 'new-version', 'utf8')

  const update = await installSkillsCore({ input: source, names: ['restore'] }, paths)
  assert.equal(update.status, 'ok')
  const updatedManifest = JSON.parse(await readFile(join(paths.trashRoot, update.operationId!, 'manifest.json'), 'utf8')) as { entries: { name: string, trashPath: string, sourcePath: string }[] }
  const entry = updatedManifest.entries.find(item => item.name === 'restore')
  assert.ok(entry)
  await rm(join(paths.skillsDir, 'restore'), { recursive: true, force: true })
  await restoreTrashEntry({ ...entry, name: 'restore' })
  assert.equal(await readFile(join(paths.skillsDir, 'restore', 'note.txt'), 'utf8'), 'new-version')
})

test('rejects an invalid staged skill without deleting the existing target', async () => {
  const bad = join(root, 'sources', 'bad')
  await mkdir(join(bad, 'broken'), { recursive: true })
  await writeFile(join(bad, 'broken', 'SKILL.md'), 'not a frontmatter', 'utf8')
  const before = await readFile(join(paths.skillsDir, 'demo', 'note.txt'), 'utf8')
  await assert.rejects(
    installSkillsCore({ input: bad, names: ['broken'] }, paths),
    /frontmatter/,
  )
  assert.equal(await readFile(join(paths.skillsDir, 'demo', 'note.txt'), 'utf8'), before)
})
