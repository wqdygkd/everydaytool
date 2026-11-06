/* eslint-disable test/no-import-node-test -- 使用 Node 内置 test runner，避免新增 Vitest 依赖 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { resolveLocalCatalog } from '../backend/sources/local.ts'
import { parseSourceInput } from '../backend/sources/parse.ts'

test('来源解析：GitHub 简写、@skill、#ref', () => {
  const parsed = parseSourceInput('mattpocock/skills@grilling#v1')
  assert.equal(parsed.sourceType, 'github')
  assert.equal(parsed.source, 'mattpocock/skills')
  assert.equal(parsed.skill, 'grilling')
  assert.equal(parsed.ref, 'v1')
})

test('来源解析：GitHub tree URL 拆出 ref 与子路径', () => {
  const parsed = parseSourceInput('https://github.com/vueuse/vueuse/tree/main/skills')
  assert.equal(parsed.sourceType, 'github')
  assert.equal(parsed.source, 'vueuse/vueuse')
  assert.equal(parsed.ref, 'main')
  assert.equal(parsed.subpath, 'skills')
})

test('来源解析：TFS /_git/、path 与 version=GB 分支', () => {
  const parsed = parseSourceInput('http://tfs.example.local:8080/tfs/Collection/Project/_git/example-skill?path=/skills/foo&version=GBmain')
  assert.equal(parsed.sourceType, 'git')
  assert.equal(parsed.source, 'http://tfs.example.local:8080/tfs/Collection/Project/_git/example-skill')
  assert.equal(parsed.ref, 'main')
  assert.equal(parsed.subpath, 'skills/foo')
  assert.equal(parsed.displayName, 'example-skill')
})

test('来源解析：本地路径与 ssh git 来源', () => {
  const local = parseSourceInput('~/work/skills-pack')
  assert.equal(local.sourceType, 'local')
  assert.equal(local.localPath, join(homedir(), 'work/skills-pack'))

  const git = parseSourceInput('git@gitlab.com:group/repo.git')
  assert.equal(git.sourceType, 'git')
  assert.equal(git.host, 'gitlab.com')
  assert.equal(git.displayName, 'repo')
})

test('本地目录：根目录 SKILL.md 视为单技能，skillPath=SKILL.md', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edt-source-root-'))
  try {
    await writeFile(join(root, 'SKILL.md'), '---\nname: root-skill\ndescription: 根技能\n---\n', 'utf8')
    const catalog = await resolveLocalCatalog(parseSourceInput(root))
    assert.equal(catalog.total, 1)
    assert.equal(catalog.rootSkill, true)
    assert.equal(catalog.entries[0]?.name, 'root-skill')
    assert.equal(catalog.entries[0]?.skillPath, 'SKILL.md')
    assert.equal(catalog.entries[0]?.description, '根技能')
    assert.match(catalog.entries[0]?.folderSha ?? '', /^[a-f0-9]{64}$/)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('本地目录：递归发现子目录技能并保留相对路径', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edt-source-nested-'))
  try {
    await mkdir(join(root, 'skills', 'alpha'), { recursive: true })
    await mkdir(join(root, 'skills', 'beta'), { recursive: true })
    await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n', 'utf8')
    await writeFile(join(root, 'skills', 'beta', 'SKILL.md'), '---\nname: beta\n---\n', 'utf8')
    const catalog = await resolveLocalCatalog(parseSourceInput(root))
    assert.equal(catalog.total, 2)
    assert.equal(catalog.rootSkill, false)
    assert.deepEqual(catalog.entries.map(entry => entry.skillPath), [
      'skills/alpha/SKILL.md',
      'skills/beta/SKILL.md',
    ])
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})
