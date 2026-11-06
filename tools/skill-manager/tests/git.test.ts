/* eslint-disable test/no-import-node-test -- 使用 Node 内置 test runner，避免新增 Vitest 依赖 */
import type { ProjectInstallPaths } from '../backend/services/project-installer.ts'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installSkillsToProject } from '../backend/services/project-installer.ts'
import { resolveGitCatalog } from '../backend/sources/git.ts'
import { parseSourceInput } from '../backend/sources/parse.ts'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'EDT',
      GIT_AUTHOR_EMAIL: 'edt@example.invalid',
      GIT_COMMITTER_NAME: 'EDT',
      GIT_COMMITTER_EMAIL: 'edt@example.invalid',
    },
  }).trim()
}

test('通用 git：根目录 SKILL.md 作为单技能解析、安装并生成 folder SHA', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edt-skill-git-'))
  try {
    const repo = join(root, 'repo')
    await mkdir(repo, { recursive: true })
    await writeFile(join(repo, 'SKILL.md'), '---\nname: root-demo\ndescription: 根目录技能\n---\n\n# Root\n', 'utf8')
    git(repo, 'init', '-q')
    git(repo, 'add', '.')
    git(repo, 'commit', '-qm', 'init')

    const url = `file://${repo}/.git`
    const parsed = parseSourceInput(url)
    assert.equal(parsed.sourceType, 'git')
    const catalog = await resolveGitCatalog(parsed)
    assert.equal(catalog.rootSkill, true)
    assert.equal(catalog.entries.length, 1)
    assert.equal(catalog.entries[0]?.skillPath, 'SKILL.md')
    assert.match(catalog.entries[0]?.folderSha ?? '', /^[\da-f]{40}$/)

    const project = join(root, 'project')
    const skillsDir = join(project, '.agents', 'skills')
    await mkdir(skillsDir, { recursive: true })
    const paths: ProjectInstallPaths = {
      projectPath: project,
      skillsDir,
      lockPath: join(project, 'skills-lock.json'),
      trashRoot: join(root, 'trash'),
      registryPath: join(root, 'config', 'registry.json'),
      historyPath: join(root, 'config', 'history.json'),
      stagingRoot: join(root, 'cache', 'staging'),
      backupRoot: join(root, 'config', 'lock-backups'),
    }
    const result = await installSkillsToProject({ input: url, names: ['root-demo'] }, paths)
    assert.equal(result.status, 'ok')
    assert.deepEqual(result.installed, ['root-demo'])
    assert.equal(await readFile(join(skillsDir, 'root-demo', 'SKILL.md'), 'utf8').then(value => value.includes('root-demo')), true)
    const lock = JSON.parse(await readFile(paths.lockPath, 'utf8')) as { version: number, skills: Record<string, { source: string, sourceType: string, skillPath: string, computedHash: string }> }
    assert.equal(lock.version, 1)
    assert.equal(lock.skills['root-demo']?.sourceType, 'git')
    assert.equal(lock.skills['root-demo']?.skillPath, 'SKILL.md')
    assert.match(lock.skills['root-demo']?.computedHash ?? '', /^[\da-f]{64}$/)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})
