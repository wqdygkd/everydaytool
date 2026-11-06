/* eslint-disable test/no-import-node-test -- 使用 Node 内置 test runner，避免新增 Vitest 依赖 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { projectScopeId, readProjectRegistry, registerProject, rescanProject } from '../backend/services/projects.ts'
import { configureProjectRegistryProvider, scanInventory } from '../backend/services/scanner.ts'

test('项目登记：扫描已登记项目并更新 lastScanAt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edt-skill-project-'))
  const registryPath = join(root, 'projects.json')
  try {
    const project = join(root, 'app')
    await mkdir(join(project, '.agents', 'skills', 'demo'), { recursive: true })
    await writeFile(join(project, '.agents', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: 项目技能\n---\n', 'utf8')
    const record = await registerProject(project, registryPath)
    assert.equal(record.id, projectScopeId(record.path))
    configureProjectRegistryProvider(() => readProjectRegistry(registryPath).projects)
    const inventory = await scanInventory()
    const scope = inventory.scopes.find(item => item.scope.id === record.id)
    assert.ok(scope)
    assert.equal(scope.scope.projectPath, record.path)
    assert.equal(scope.skills.some(skill => skill.name === 'demo' && skill.state === 'orphan'), true)

    const rescanned = await rescanProject(record.id, registryPath)
    assert.ok(rescanned.lastScanAt)
    assert.equal(readProjectRegistry(registryPath).projects[0]?.lastScanAt, rescanned.lastScanAt)
  }
  finally {
    configureProjectRegistryProvider(undefined)
    await rm(root, { recursive: true, force: true })
  }
})
