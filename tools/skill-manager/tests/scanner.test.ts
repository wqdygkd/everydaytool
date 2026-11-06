/* eslint-disable test/no-import-node-test -- 使用 Node 内置 test runner，避免新增 Vitest 依赖 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSkillFrontmatter, readSkill, scanInventory } from '../backend/services/scanner.ts'

test('frontmatter：解析 name / description / category，无 frontmatter 返回 null', () => {
  assert.deepEqual(
    parseSkillFrontmatter('---\nname: demo\ndescription: "含: 冒号的描述"\ncategory: UI\n---\n# Demo'),
    { name: 'demo', description: '含: 冒号的描述', category: 'UI' },
  )
  assert.equal(parseSkillFrontmatter('# 没有 frontmatter'), null)
  assert.equal(parseSkillFrontmatter('---\nname: no-close'), null)
  assert.deepEqual(parseSkillFrontmatter('\uFEFF---\nname: \'quoted\'\n---\n'), { name: 'quoted' })
})

test('扫描：项目 38 个目录、34 条锁、4 个未托管，且不误报 modified', async () => {
  const inventory = await scanInventory()
  const project = inventory.scopes.find(scope => scope.scope.kind === 'project')
  assert.ok(project, '当前仓库应被识别为 project scope')
  if (!project) return

  assert.equal(project.summary.total, 38)
  assert.equal(project.summary.onDisk, 38)
  assert.equal(project.summary.tracked, 34)
  assert.equal(project.summary.untracked, 4)
  assert.equal(project.summary.missing, 0)
  assert.equal(project.summary.modified, 0)
  assert.ok(project.skills.every(skill => !skill.localModified))

  const orphanGroup = project.groups.find(group => group.orphan)
  assert.ok(orphanGroup)
  if (!orphanGroup) return
  assert.equal(orphanGroup.skills.length, 4)
  assert.deepEqual(
    orphanGroup.skills.map(skill => skill.name).sort(),
    ['gsap-react', 'shadcn-vue', 'supabase', 'supabase-postgres-best-practices'],
  )
})

test('扫描：全局目录能识别 symlink、断链和锁记录缺目录', async () => {
  const inventory = await scanInventory()
  const global = inventory.scopes.find(scope => scope.scope.kind === 'global')
  assert.ok(global)
  if (!global) return

  assert.equal(global.summary.onDisk + global.summary.missing, global.summary.total)
  assert.ok(global.summary.linked >= 1)
  assert.ok(global.skills.some(skill => skill.installMode === 'symlink'))
  if (global.skills.some(skill => skill.name === 'coding-standards')) {
    assert.equal(global.skills.find(skill => skill.name === 'coding-standards')?.state, 'missing')
  }
  assert.ok(global.skills.every(skill => skill.localModified === false))
})

test('readSkill：读取真实技能，拒绝路径穿越和隐藏目录', async () => {
  const inventory = await scanInventory()
  const project = inventory.scopes.find(scope => scope.scope.kind === 'project')
  if (!project) return

  const result = await readSkill(project.scope.id, 'grilling')
  assert.match(result.markdown, /^---\nname: grilling/)
  assert.ok(result.files.some(file => file.path === 'SKILL.md'))

  await assert.rejects(() => readSkill(project.scope.id, '../grilling'))
  await assert.rejects(() => readSkill(project.scope.id, '.hidden'))
  await assert.rejects(() => readSkill(project.scope.id, 'a/b'))
})
