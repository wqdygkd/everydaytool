/* eslint-disable test/no-import-node-test -- 使用 Node 内置 test runner，避免新增 Vitest 依赖 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  configureScannerEnvironment,
  parseSkillFrontmatter,
  readSkill,
  scanInventory,
} from '../backend/services/scanner.ts'

const SKILL = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\ncategory: test\n---\n# ${name}\n`

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'edt-skill-scan-'))
  const home = join(root, 'home')
  const project = join(root, 'project')
  const globalSkillsDir = join(home, '.agents', 'skills')
  const projectSkillsDir = join(project, '.agents', 'skills')
  const globalLockPath = join(home, '.agents', '.skill-lock.json')

  await mkdir(join(globalSkillsDir, 'beta'), { recursive: true })
  await writeFile(join(globalSkillsDir, 'beta', 'SKILL.md'), SKILL('beta'))
  await writeFile(globalLockPath, JSON.stringify({
    version: 3,
    skills: {
      beta: { source: 'acme/skills', sourceType: 'github', skillFolderHash: 'hash-beta', skillPath: 'beta/SKILL.md' },
    },
  }, null, 2))

  await mkdir(join(projectSkillsDir, 'alpha'), { recursive: true })
  await writeFile(join(projectSkillsDir, 'alpha', 'SKILL.md'), SKILL('alpha'))
  await mkdir(join(projectSkillsDir, 'orphan'), { recursive: true })
  await writeFile(join(projectSkillsDir, 'orphan', 'SKILL.md'), SKILL('orphan'))
  // 目录存在但没有 SKILL.md：invalid
  await mkdir(join(projectSkillsDir, 'broken'), { recursive: true })
  await writeFile(join(projectSkillsDir, 'broken', 'README.md'), '# no skill file')
  // gone 只有锁记录，没有目录：missing
  await writeFile(join(project, 'skills-lock.json'), JSON.stringify({
    version: 2,
    skills: {
      alpha: { source: './sources/alpha', sourceType: 'local', computedHash: 'sha256:alpha', skillPath: 'alpha/SKILL.md' },
      gone: { source: './sources/gone', sourceType: 'local', computedHash: 'sha256:gone', skillPath: 'gone/SKILL.md' },
    },
  }, null, 2))

  let linkCreated = false
  try {
    await symlink(join(projectSkillsDir, 'alpha'), join(globalSkillsDir, 'linked'), 'junction')
    linkCreated = true
  } catch {
    // Windows 未开启开发者模式时可能没有创建符号链接的权限，跳过链接断言
  }

  configureScannerEnvironment({ cwd: project, homeDir: home, globalSkillsDir, globalLockPath })
  return {
    root,
    project,
    globalSkillsDir,
    linkCreated,
    async cleanup() {
      configureScannerEnvironment(undefined)
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('frontmatter：解析 name / description / category，无 frontmatter 返回 null', () => {
  assert.deepEqual(
    parseSkillFrontmatter('---\nname: demo\ndescription: "含: 冒号的描述"\ncategory: UI\n---\n# Demo'),
    { name: 'demo', description: '含: 冒号的描述', category: 'UI' },
  )
  assert.equal(parseSkillFrontmatter('# 没有 frontmatter'), null)
  assert.equal(parseSkillFrontmatter('---\nname: no-close'), null)
  assert.deepEqual(parseSkillFrontmatter('\uFEFF---\nname: \'quoted\'\n---\n'), { name: 'quoted' })
})

test('扫描：项目夹具区分已托管 / 未托管 / 无效 / 缺目录', async () => {
  const fx = await fixture()
  try {
    const inventory = await scanInventory()
    assert.deepEqual(inventory.scopes.map(scope => scope.scope.kind), ['global', 'project'])
    const project = inventory.scopes.find(scope => scope.scope.kind === 'project')
    assert.ok(project, '夹具目录应被识别为 project scope')
    if (!project) return

    assert.equal(project.scope.projectPath, await realpath(fx.project))
    assert.equal(project.summary.total, 4)
    assert.equal(project.summary.onDisk, 3)
    assert.equal(project.summary.tracked, 2)
    assert.equal(project.summary.untracked, 2)
    assert.equal(project.summary.missing, 1)
    assert.equal(project.summary.invalid, 1)
    assert.equal(project.summary.modified, 0)
    assert.ok(project.skills.every(skill => !skill.localModified))

    const states = Object.fromEntries(project.skills.map(skill => [skill.name, skill.state]))
    assert.deepEqual(states, {
      alpha: 'ok',
      broken: 'invalid',
      gone: 'missing',
      orphan: 'orphan',
    })

    const orphanGroup = project.groups.find(group => group.orphan)
    assert.ok(orphanGroup)
    // 未托管分组按“无锁记录”归组，invalid 的 broken 同样没有锁记录
    assert.deepEqual(orphanGroup?.skills.map(skill => skill.name), ['broken', 'orphan'])
  } finally {
    await fx.cleanup()
  }
})

test('扫描：全局目录识别已托管技能与 symlink', async () => {
  const fx = await fixture()
  try {
    const inventory = await scanInventory()
    const global = inventory.scopes.find(scope => scope.scope.kind === 'global')
    assert.ok(global)
    if (!global) return

    assert.equal(global.scope.lockState, 'ok')
    assert.equal(global.skills.find(skill => skill.name === 'beta')?.state, 'ok')
    assert.ok(global.skills.every(skill => skill.localModified === false))
    if (fx.linkCreated) {
      assert.equal(global.summary.total, 2)
      assert.equal(global.summary.linked, 1)
      assert.ok(global.skills.some(skill => skill.name === 'linked' && skill.installMode === 'symlink'))
    } else {
      assert.equal(global.summary.total, 1)
    }
  } finally {
    await fx.cleanup()
  }
})

test('readSkill：读取夹具技能，拒绝路径穿越和隐藏目录', async () => {
  const fx = await fixture()
  try {
    const inventory = await scanInventory()
    const project = inventory.scopes.find(scope => scope.scope.kind === 'project')
    assert.ok(project)
    if (!project) return

    const result = await readSkill(project.scope.id, 'alpha')
    assert.match(result.markdown, /^---\nname: alpha/)
    assert.ok(result.files.some(file => file.path === 'SKILL.md'))

    await assert.rejects(() => readSkill(project.scope.id, '../alpha'))
    await assert.rejects(() => readSkill(project.scope.id, '.hidden'))
    await assert.rejects(() => readSkill(project.scope.id, 'a/b'))
  } finally {
    await fx.cleanup()
  }
})
