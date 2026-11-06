import type {
  PresetApplyRequest,
  PresetApplyResult,
  PresetSaveRequest,
  PresetsExportResult,
  PresetsFile,
  PresetTarget,
} from '../../../../shared/skill-manager.ts'
import { readFavorites } from './favorites.ts'
import { appendSkillManagerHistory } from './history.ts'
import {
  getDefaultFavoritesPath,
  getDefaultInstallPaths,
  getDefaultLockBackupRoot,
  getDefaultPresetsPath,
  getDefaultProjectInstallPaths,
  getDefaultProjectRegistryPath,
  getDefaultSkillManagerSettingsPath,
} from './installer.ts'
import { applyPresetCore } from './preset-apply-core.ts'
import { deletePreset, exportPresets, importPresets, readPresets, savePreset, writePresets } from './presets.ts'
import { normalizeProjectPath, projectScopeId, registerProject } from './projects.ts'
import { readSkillManagerSettings } from './settings.ts'

async function resolveApplyPaths(target: PresetTarget) {
  const removePolicy = readSkillManagerSettings(getDefaultSkillManagerSettingsPath()).removePolicy
  if (target.kind === 'global') {
    const paths = getDefaultInstallPaths()
    return {
      kind: 'global' as const,
      scopeId: 'global',
      ...paths,
      backupRoot: getDefaultLockBackupRoot(),
      removePolicy,
    }
  }
  if (!target.path) throw new Error('预设目标缺少目录')
  const root = await normalizeProjectPath(target.path)
  if (target.asSkillsRoot) throw new Error('自定义目录直接作为技能根暂未开放')
  const paths = getDefaultProjectInstallPaths(root)
  return {
    kind: target.kind,
    scopeId: projectScopeId(root),
    skillsDir: paths.skillsDir,
    lockPath: paths.lockPath,
    registryPath: paths.registryPath,
    historyPath: paths.historyPath,
    trashRoot: paths.trashRoot,
    stagingRoot: paths.stagingRoot,
    backupRoot: paths.backupRoot,
    projectPath: root,
    removePolicy,
  }
}

export function getPresets(): PresetsFile {
  return readPresets(getDefaultPresetsPath())
}

export function savePresetEntry(request: PresetSaveRequest): PresetsFile {
  const path = getDefaultPresetsPath()
  const file = readPresets(path)
  savePreset(file, request)
  return writePresets(file, path)
}

export function deletePresetEntry(id: string): PresetsFile {
  const path = getDefaultPresetsPath()
  const file = readPresets(path)
  deletePreset(file, id)
  return writePresets(file, path)
}

export function exportPresetFile(): PresetsExportResult {
  const file = readPresets(getDefaultPresetsPath())
  return { raw: exportPresets(file), count: Object.keys(file.presets).length }
}

export function importPresetFile(raw: string): PresetsFile {
  const path = getDefaultPresetsPath()
  const file = readPresets(path)
  importPresets(file, raw)
  return writePresets(file, path)
}

export async function applyPreset(request: PresetApplyRequest): Promise<PresetApplyResult> {
  const presetsPath = getDefaultPresetsPath()
  const file = readPresets(presetsPath)
  const preset = file.presets[request.presetId]
  if (!preset) throw new Error('预设不存在')
  const paths = await resolveApplyPaths(request.target)
  const result = await applyPresetCore(request, preset, paths)

  const now = new Date().toISOString()
  preset.lastAppliedAt = now
  preset.lastApplyTarget = request.target
  preset.updatedAt = now
  writePresets(file, presetsPath)

  if (request.target.kind !== 'global' && request.registerProject && paths.projectPath) {
    const project = await registerProject(paths.projectPath, getDefaultProjectRegistryPath())
    result.projectId = project.id
  }

  appendSkillManagerHistory({
    id: `smhistory_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    at: now,
    action: 'preset-apply',
    scopeId: paths.scopeId,
    operationId: result.operationId,
    names: [...result.installed, ...result.updated, ...result.removed],
    status: result.status === 'ok' ? 'ok' : 'failed',
    detail: `预设 ${preset.name} · ${result.mode}`,
  }, paths.historyPath)
  return result
}

/** 预留给 UI 的“收藏转预设”：只取来源，不读文件。 */
export function presetItemsFromFavoriteCategory(categoryId: string) {
  const file = readFavorites(getDefaultFavoritesPath())
  return Object.entries(file.items)
    .filter(([, item]) => item.categories.includes(categoryId))
    .map(([key, item]) => ({
      key,
      name: item.name,
      origin: item.origin,
      installName: item.name,
      enabled: true,
    }))
}
