import type {
  ForgetRemovedRequest,
  Inventory,
  ReinstallRemovedRequest,
  RemovedSkillsResult,
} from '../../../../shared/skill-manager.ts'
import type { InstallPaths } from './installer-core.ts'
import type { ProjectInstallPaths } from './project-installer.ts'
import { scanInventoryWithDisabled } from './disabled-service.ts'
import {
  getDefaultInstallPaths,
  getDefaultProjectInstallPaths,
  getDefaultRegistryPath,
} from './installer.ts'
import { readSkillManagerRegistry } from './registry.ts'
import { forgetRemovedCore, reinstallRemovedCore } from './removed-core.ts'

export interface RemovedServiceOptions {
  registryPath?: string
  inventory?: Inventory
  installPaths?: InstallPaths
  projectPaths?: (projectPath: string) => ProjectInstallPaths
}

export async function listRemovedSkills(options: RemovedServiceOptions = {}): Promise<RemovedSkillsResult> {
  const inventory = options.inventory ?? await scanInventoryWithDisabled()
  return {
    items: inventory.scopes
      .flatMap(item => item.removed)
      .sort((a, b) => b.removedAt.localeCompare(a.removedAt) || a.name.localeCompare(b.name)),
  }
}

export async function forgetRemovedSkill(
  request: ForgetRemovedRequest,
  options: RemovedServiceOptions = {},
): Promise<void> {
  forgetRemovedCore(request.scopeId, request.name, options.registryPath ?? getDefaultRegistryPath())
}

export async function reinstallRemovedSkill(
  request: ReinstallRemovedRequest,
  options: RemovedServiceOptions = {},
) {
  const registryPath = options.registryPath ?? getDefaultRegistryPath()
  const record = readSkillManagerRegistry(registryPath).scopes[request.scopeId]?.records[request.name]
  if (!record || (record.state !== 'removed' && record.state !== 'installed'))
    throw new Error(`没有可重装的墓碑：${request.name}`)

  const inventory = options.inventory ?? await scanInventoryWithDisabled()
  const scope = inventory.scopes.find(item => item.scope.id === request.scopeId)?.scope
  if (!scope) throw new Error(`未找到作用域：${request.scopeId}`)

  return reinstallRemovedCore(request.name, record, scope, {
    registryPath,
    global: options.installPaths ?? getDefaultInstallPaths(),
    project: options.projectPaths ?? getDefaultProjectInstallPaths,
  })
}
