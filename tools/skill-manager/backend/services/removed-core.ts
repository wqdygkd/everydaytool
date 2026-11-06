import type { InstallResult, Scope, SkillManagerRecord } from '../../../../shared/skill-manager.ts'
import type { InstallPaths } from './installer-core.ts'
import type { ProjectInstallPaths } from './project-installer.ts'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { resolveSource } from '../sources/catalog.ts'
import { installSkillsCore } from './installer-core.ts'
import { installSkillsToProject } from './project-installer.ts'
import { readSkillManagerRegistry, writeSkillManagerRegistry } from './registry.ts'

export interface RemovedServicePaths {
  registryPath: string
  global: InstallPaths
  project?: (projectPath: string) => ProjectInstallPaths
}

/** Reinstall a tombstoned record using an injected scope and install paths. */
export async function reinstallRemovedCore(
  name: string,
  record: SkillManagerRecord,
  scope: Scope,
  paths: RemovedServicePaths,
): Promise<InstallResult> {
  if (scope.kind === 'project' && !scope.projectPath) throw new Error('项目路径不可用')
  const source = record.origin.sourceType === 'local' && !isAbsolute(record.origin.source)
    ? resolve(scope.projectPath ?? process.cwd(), record.origin.source)
    : record.origin.source
  const catalog = await resolveSource(source, record.origin.ref ?? undefined)
  const target = (record.origin.skillPath
    ? catalog.entries.find(item => item.skillPath === record.origin.skillPath)
    : undefined)
  ?? (catalog.entries.length === 1
    ? catalog.entries[0]
    : catalog.entries.find(item => item.name === name))
  if (!target) throw new Error(`来源中找不到 ${name}`)

  if (scope.kind === 'project') {
    const projectPath = scope.projectPath
    if (!projectPath) throw new Error('项目路径不可用')
    if (!paths.project) throw new Error('项目安装路径不可用')
    const projectPaths = paths.project(projectPath)
    return installSkillsToProject({
      input: source,
      ref: record.origin.ref ?? undefined,
      names: [target.name],
      scopeId: scope.id,
      projectPath: scope.projectPath,
    }, projectPaths)
  }

  return installSkillsCore({
    input: source,
    ref: record.origin.ref ?? undefined,
    names: [target.name],
    scopeId: 'global',
  }, paths.global)
}

export function forgetRemovedCore(scopeId: string, name: string, registryPath: string): void {
  const registry = readSkillManagerRegistry(registryPath)
  const scope = registry.scopes[scopeId]
  if (!scope?.records[name]) throw new Error(`墓碑不存在：${name}`)
  delete scope.records[name]
  for (const group of Object.values(registry.groups)) {
    group.selectedNames = group.selectedNames.filter(item => item !== name)
    group.installedNames = group.installedNames.filter(item => item !== name)
    group.disabledNames = group.disabledNames.filter(item => item !== name)
  }
  writeSkillManagerRegistry(registry, registryPath)
}
