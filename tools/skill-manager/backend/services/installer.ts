import type { InstallResult, InstallSkillsRequest } from '../../../../shared/skill-manager.ts'
import type { InstallPaths } from './installer-core.ts'
import type { ProjectInstallPaths } from './project-installer.ts'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveLayerPath } from '../../../../backend/utils/data-layers.ts'
import { getGlobalLockPath } from '../locks/global-lock.ts'
import { getProjectLockPath } from '../locks/project-lock.ts'
import { cleanupStaleInstallArtifacts as cleanupCore, installSkillsCore } from './installer-core.ts'
import { installSkillsToProject } from './project-installer.ts'

export type { InstallPaths } from './installer-core.ts'
export type { ProjectInstallPaths } from './project-installer.ts'

export function getDefaultInstallPaths(): InstallPaths {
  return {
    skillsDir: join(homedir(), '.agents', 'skills'),
    lockPath: getGlobalLockPath(),
    trashRoot: resolveLayerPath('assets', 'skill-manager', 'trash'),
    registryPath: resolveLayerPath('config', 'skill-manager', 'registry.json'),
    historyPath: resolveLayerPath('config', 'skill-manager', 'history.json'),
    stagingRoot: resolveLayerPath('cache', 'skill-manager', 'staging'),
  }
}

export function getDefaultProjectInstallPaths(projectPath: string): ProjectInstallPaths {
  const root = resolve(projectPath)
  return {
    projectPath: root,
    skillsDir: join(root, '.agents', 'skills'),
    lockPath: getProjectLockPath(root),
    trashRoot: resolveLayerPath('assets', 'skill-manager', 'trash'),
    registryPath: resolveLayerPath('config', 'skill-manager', 'registry.json'),
    historyPath: resolveLayerPath('config', 'skill-manager', 'history.json'),
    stagingRoot: resolveLayerPath('cache', 'skill-manager', 'staging'),
    backupRoot: resolveLayerPath('config', 'skill-manager', 'lock-backups'),
  }
}

export function getDefaultProjectRegistryPath(): string {
  return resolveLayerPath('config', 'skill-manager', 'projects.json')
}

/** 生产入口：默认路径依赖 Electron 数据目录，测试请直接调用 installer-core。 */
export function installSkills(
  request: InstallSkillsRequest,
  paths: InstallPaths = getDefaultInstallPaths(),
): Promise<InstallResult> {
  if (request.projectPath) {
    return installSkillsToProject(request, getDefaultProjectInstallPaths(request.projectPath))
  }
  return installSkillsCore(request, paths)
}

export function cleanupStaleInstallArtifacts(paths: InstallPaths = getDefaultInstallPaths()): Promise<void> {
  return cleanupCore(paths)
}

export function getDefaultDisabledRoot(): string {
  return resolveLayerPath('assets', 'skill-manager', 'disabled')
}

export function getDefaultTrashRoot(): string {
  return resolveLayerPath('assets', 'skill-manager', 'trash')
}

export function getDefaultFavoritesPath(): string {
  return resolveLayerPath('config', 'skill-manager', 'favorites.json')
}

export function getDefaultPresetsPath(): string {
  return resolveLayerPath('config', 'skill-manager', 'presets.json')
}

export function getDefaultRegistryPath(): string {
  return resolveLayerPath('config', 'skill-manager', 'registry.json')
}

export function getDefaultHistoryPath(): string {
  return resolveLayerPath('config', 'skill-manager', 'history.json')
}

export function getDefaultSkillManagerSettingsPath(): string {
  return resolveLayerPath('config', 'skill-manager', 'settings.json')
}

export function getDefaultLockBackupRoot(): string {
  return resolveLayerPath('config', 'skill-manager', 'lock-backups')
}
