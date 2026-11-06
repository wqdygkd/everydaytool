/* eslint-disable test/no-import-node-test */
import type { ProjectInstallPaths } from '../backend/services/project-installer.ts'
import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { emptyProjectLock } from '../../../shared/skill-manager.ts'
import { writeProjectLock } from '../backend/locks/project-lock.ts'
import { hashSkillDirectory } from '../backend/services/hash.ts'
import { installSkillsToProject } from '../backend/services/project-installer.ts'
import { registerProject, unregisterProject } from '../backend/services/projects.ts'

let root = ''
let project = ''
let paths: ProjectInstallPaths

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'edt-skill-project-'))
  project = join(root, 'project')
  await mkdir(project, { recursive: true })
  paths = {
    projectPath: project,
    skillsDir: join(project, '.agents', 'skills'),
    lockPath: join(project, 'skills-lock.json'),
    trashRoot: join(root, 'trash'),
    registryPath: join(root, 'config', 'registry.json'),
    historyPath: join(root, 'config', 'history.json'),
    stagingRoot: join(root, 'cache', 'staging'),
    backupRoot: join(root, 'config', 'lock-backups'),
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

test('writes project lock v1, preserves unknown fields, sorts and backs up', async () => {
  const original = `{
  "version": 1,
  "generatedBy": "keep-me",
  "skills": {
    "zzz": {
      "source": "owner/repo",
      "sourceType": "github",
      "skillPath": "skills/zzz/SKILL.md",
      "computedHash": "old",
      "custom": "keep-entry"
    }
  }
}
`
  await writeFile(paths.lockPath, original, 'utf8')
  const source = await makeSource('demo')
  const result = await installSkillsToProject({ input: source, names: ['demo'], projectPath: project }, paths)
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.installed, ['demo'])

  const raw = await readFile(paths.lockPath, 'utf8')
  assert.ok(raw.endsWith('\n'))
  const lock = JSON.parse(raw) as {
    version: number
    generatedBy: string
    skills: Record<string, { source: string, computedHash: string, custom?: string }>
  }
  assert.equal(lock.version, 1)
  assert.equal(lock.generatedBy, 'keep-me')
  assert.equal(lock.skills.zzz.custom, 'keep-entry')
  assert.equal(lock.skills.demo.source, '../sources/demo')
  assert.equal(lock.skills.demo.computedHash, await hashSkillDirectory(join(paths.skillsDir, 'demo')))
  assert.deepEqual(Object.keys(lock.skills), ['demo', 'zzz'])
  assert.ok(raw.indexOf('"demo"') < raw.indexOf('"zzz"'))
  assert.equal(await readFile(join(paths.skillsDir, 'demo', 'note.txt'), 'utf8'), 'demo')

  const backup = await readFile(join(paths.backupRoot, `${result.operationId}.json`), 'utf8')
  assert.equal(backup, original)

  const registry = JSON.parse(await readFile(paths.registryPath, 'utf8')) as {
    scopes: Record<string, { lockFingerprint: string, records: Record<string, { state: string }> }>
  }
  assert.equal(registry.scopes[result.scopeId]?.records.demo.state, 'installed')
  assert.match(registry.scopes[result.scopeId]?.lockFingerprint ?? '', /^sha256:/)
})

test('updates the same project source and blocks a different source', async () => {
  const source = join(root, 'sources', 'demo')
  await writeFile(join(source, 'note.txt'), 'updated', 'utf8')
  const update = await installSkillsToProject({ input: source, names: ['demo'], projectPath: project }, paths)
  assert.equal(update.status, 'ok')
  assert.deepEqual(update.updated, ['demo'])
  assert.equal(await readFile(join(paths.skillsDir, 'demo', 'note.txt'), 'utf8'), 'updated')

  const other = join(root, 'sources', 'other-demo')
  await mkdir(other, { recursive: true })
  await writeFile(join(other, 'SKILL.md'), '---\nname: demo\ndescription: other\n---\n', 'utf8')
  const conflict = await installSkillsToProject({ input: other, names: ['demo'], projectPath: project }, paths)
  assert.equal(conflict.status, 'conflict')
  assert.equal(conflict.conflicts[0]?.reason, 'different-source')
  assert.equal(await readFile(join(paths.skillsDir, 'demo', 'note.txt'), 'utf8'), 'updated')
})

test('creates a v1 lock when the project has none', async () => {
  const fresh = join(root, 'fresh-project')
  await mkdir(fresh, { recursive: true })
  const source = await makeSource('fresh')
  const freshPaths: ProjectInstallPaths = {
    ...paths,
    projectPath: fresh,
    skillsDir: join(fresh, '.agents', 'skills'),
    lockPath: join(fresh, 'skills-lock.json'),
  }
  const result = await installSkillsToProject({ input: source, names: ['fresh'], projectPath: fresh }, freshPaths)
  assert.equal(result.status, 'ok')
  const raw = await readFile(freshPaths.lockPath, 'utf8')
  assert.ok(raw.endsWith('\n'))
  const lock = JSON.parse(raw) as { version: number, skills: Record<string, unknown> }
  assert.equal(lock.version, 1)
  assert.ok(lock.skills.fresh)
})

test('registers a project once and unregisters it by id', async () => {
  const registryPath = join(root, 'config', 'projects.json')
  const first = await registerProject(project, registryPath)
  const second = await registerProject(project, registryPath)
  assert.equal(first.id, second.id)
  assert.equal(first.path, await realpath(project))
  await unregisterProject(first.id, registryPath)
  const { readProjectRegistry } = await import('../backend/services/projects.ts')
  assert.deepEqual(readProjectRegistry(registryPath).projects, [])
})

test('refuses to overwrite a project lock that changed after reading', async () => {
  const raw = await readFile(paths.lockPath, 'utf8')
  const changed = raw.replace('"generatedBy": "keep-me"', '"generatedBy": "changed"')
  await writeFile(paths.lockPath, changed, 'utf8')
  await assert.rejects(
    writeProjectLock(emptyProjectLock(), project, {
      operationId: 'test-operation',
      backupRoot: paths.backupRoot,
      expectedRaw: raw,
    }),
    /修改/,
  )
  assert.equal(await readFile(paths.lockPath, 'utf8'), changed)
})
