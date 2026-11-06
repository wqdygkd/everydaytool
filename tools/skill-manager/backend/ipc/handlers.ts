import type { AdoptRequest, ApplyPlanRequest, CheckUpdatesRequest, FavoriteCategoryRequest, FavoriteToggleRequest, FavoriteUpdateRequest, InstallSkillsRequest, Inventory, PresetApplyRequest, PresetItem, PresetSaveRequest, PresetTarget, SetEnabledRequest, SkillManagerSettings, SkillOrigin, SkillState, UndoPlanRequest } from '../../../../shared/skill-manager.ts'
import { ipcMain } from 'electron'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { adoptSkill } from '../services/adopt.ts'
import { deleteSkillManagerToken, getSkillManagerToken, listSkillManagerTokens, saveSkillManagerToken } from '../services/credentials.ts'
import { deleteSkill } from '../services/delete-skill.ts'
import { scanInventoryWithDisabled, setSkillEnabled } from '../services/disabled-service.ts'
import { deleteFavoriteCategory, getFavorites, saveFavoriteCategory, toggleFavorite, updateFavoriteItem } from '../services/favorites-service.ts'
import { getDefaultProjectRegistryPath, getDefaultSkillManagerSettingsPath, getDefaultTrashRoot, installSkills } from '../services/installer.ts'
import { applyUpdatePlan, checkUpdates, undoLastPlan } from '../services/planner.ts'
import { applyPreset, deletePresetEntry, exportPresetFile, getPresets, importPresetFile, savePresetEntry } from '../services/presets-service.ts'
import { readProjectRegistry, registerProject, rescanProject, unregisterProject } from '../services/projects.ts'
import { forgetRemovedSkill, listRemovedSkills, reinstallRemovedSkill } from '../services/removed-service.ts'
import { configureProjectRegistryProvider, readSkill, toOverview } from '../services/scanner.ts'
import { normalizeSkillManagerSettings, readSkillManagerSettings, writeSkillManagerSettings } from '../services/settings.ts'
import { clearTrash, deleteTrashItem, listTrash, restoreTrashItem } from '../services/trash.ts'
import { configureSourceAuthProvider, getRepoCatalog, resolveSource } from '../sources/catalog.ts'
import { SKILL_MANAGER_IPC_CHANNELS } from './channels.ts'

let handlersRegistered = false

function optionalScopeId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 200) throw new Error('作用域 ID 非法')
  return value
}

function optionalString(value: unknown, label: string, maxLength = 200): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`${label}非法`)
  return value
}

function requiredString(value: unknown, label: string, maxLength = 2000): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`)
  if (value.length > maxLength) throw new Error(`${label}过长`)
  return value.trim()
}

function parseResolvePayload(value: unknown): { input: string, ref?: string } {
  if (typeof value !== 'object' || value === null) throw new Error('来源参数非法')
  const payload = value as Record<string, unknown>
  const input = requiredString(payload.input, '来源')
  const ref = optionalString(payload.ref, 'ref')
  return { input, ref }
}

function parseRepoCatalogPayload(value: unknown): { scopeId: string, groupKey: string } {
  if (typeof value !== 'object' || value === null) throw new Error('仓库参数非法')
  const payload = value as Record<string, unknown>
  const scopeId = optionalScopeId(payload.scopeId)
  const groupKey = optionalString(payload.groupKey, '仓库组')
  if (!scopeId || !groupKey) throw new Error('仓库参数缺少 scopeId 或 groupKey')
  return { scopeId, groupKey }
}

function parseInstallPayload(value: unknown): InstallSkillsRequest {
  if (typeof value !== 'object' || value === null) throw new Error('安装参数非法')
  const payload = value as Record<string, unknown>
  const input = requiredString(payload.input, '来源')
  const ref = optionalString(payload.ref, 'ref')
  const scopeId = optionalScopeId(payload.scopeId)
  const projectPath = optionalString(payload.projectPath, '项目路径')
  if (!Array.isArray(payload.names) || payload.names.length === 0) throw new Error('至少选择一个技能')
  if (payload.names.length > 200) throw new Error('一次最多安装 200 个技能')
  const names = payload.names.map((name) => {
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('技能名称非法')
    return name.trim()
  })
  return { input, ref, names, scopeId: scopeId ?? (projectPath ? undefined : 'global'), projectPath }
}

function parseCheckUpdatesPayload(value: unknown): CheckUpdatesRequest {
  if (typeof value !== 'object' || value === null) throw new Error('更新检查参数非法')
  const payload = value as Record<string, unknown>
  const scopeId = optionalScopeId(payload.scopeId)
  const groupKey = optionalString(payload.groupKey, '仓库组')
  if (!scopeId || !groupKey) throw new Error('更新检查缺少 scopeId 或 groupKey')
  return { scopeId, groupKey }
}

function parseApplyPlanPayload(value: unknown): ApplyPlanRequest {
  if (typeof value !== 'object' || value === null) throw new Error('应用计划参数非法')
  const payload = value as Record<string, unknown>
  const planId = requiredString(payload.planId, '计划 ID')
  if (!Array.isArray(payload.names) || payload.names.length === 0) throw new Error('至少选择一个动作')
  if (payload.names.length > 200) throw new Error('一次最多处理 200 个技能')
  const names = payload.names.map((name) => {
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('技能名称非法')
    return name.trim()
  })
  return { planId, names }
}

function parseUndoPlanPayload(value: unknown): UndoPlanRequest {
  if (typeof value !== 'object' || value === null) throw new Error('撤销参数非法')
  const payload = value as Record<string, unknown>
  const scopeId = optionalScopeId(payload.scopeId)
  if (!scopeId) throw new Error('撤销缺少 scopeId')
  const historyId = optionalString(payload.historyId, '历史 ID')
  return { scopeId, historyId }
}

function parseAdoptPayload(value: unknown): AdoptRequest {
  if (typeof value !== 'object' || value === null) throw new Error('接管参数非法')
  const payload = value as Record<string, unknown>
  const scopeId = optionalScopeId(payload.scopeId)
  const name = optionalString(payload.name, '技能名称')
  const mode = payload.mode === 'source' || payload.mode === 'local' ? payload.mode : undefined
  if (!scopeId || !name || !mode) throw new Error('接管参数缺少 scopeId、name 或 mode')
  const input = optionalString(payload.input, '来源', 4096)
  if (mode === 'source' && !input) throw new Error('绑定来源接管需要填写来源')
  return {
    scopeId,
    name,
    mode,
    input,
    ref: optionalString(payload.ref, 'ref'),
    skillPath: optionalString(payload.skillPath, '技能路径', 2000),
  }
}

function parseSkillPayload(value: unknown): { scopeId: string, name: string } {
  if (typeof value !== 'object' || value === null) throw new Error('技能参数非法')
  const payload = value as Record<string, unknown>
  const scopeId = optionalScopeId(payload.scopeId)
  const name = optionalString(payload.name, '技能名称')
  if (!scopeId || !name) throw new Error('技能参数缺少 scopeId 或 name')
  return { scopeId, name }
}

function parseListFilter(value: unknown): { scopeId?: string, groupKey?: string, state?: SkillState } {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object') throw new Error('筛选参数非法')
  const payload = value as Record<string, unknown>
  return {
    scopeId: optionalScopeId(payload.scopeId),
    groupKey: optionalString(payload.groupKey, '仓库组'),
    state: optionalString(payload.state, '状态') as SkillState | undefined,
  }
}

function parseSetEnabledPayload(value: unknown): SetEnabledRequest {
  if (typeof value !== 'object' || value === null) throw new Error('禁用参数非法')
  const payload = value as Record<string, unknown>
  const scopeId = optionalScopeId(payload.scopeId)
  if (!scopeId) throw new Error('禁用缺少 scopeId')
  if (!Array.isArray(payload.names) || payload.names.length === 0) throw new Error('至少选择一个技能')
  const names = payload.names.map((name) => {
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('技能名称非法')
    return name.trim()
  })
  if (typeof payload.enabled !== 'boolean') throw new Error('缺少 enabled')
  return { scopeId, names, enabled: payload.enabled }
}

function parseTrashPayload(value: unknown): { operationId: string, name: string } {
  if (typeof value !== 'object' || value === null) throw new Error('回收站参数非法')
  const payload = value as Record<string, unknown>
  const operationId = optionalString(payload.operationId, '回收站操作 ID')
  const name = optionalString(payload.name, '技能名称')
  if (!operationId || !name) throw new Error('回收站参数缺少 operationId 或 name')
  return { operationId, name }
}

function parseOrigin(value: unknown): SkillOrigin {
  if (typeof value !== 'object' || value === null) throw new Error('技能来源非法')
  const origin = value as Record<string, unknown>
  if (typeof origin.source !== 'string' || !origin.source.trim()) throw new Error('技能来源不能为空')
  if (typeof origin.sourceType !== 'string' || !origin.sourceType) throw new Error('技能来源类型非法')
  return {
    sourceType: origin.sourceType as SkillOrigin['sourceType'],
    source: origin.source,
    sourceUrl: optionalString(origin.sourceUrl, '来源 URL'),
    ref: optionalString(origin.ref, 'ref') ?? null,
    skillPath: optionalString(origin.skillPath, '技能路径'),
  }
}

function parseCategories(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 30) throw new Error('分类参数非法')
  return value.map((category) => {
    if (typeof category !== 'string' || category.length > 60) throw new Error('分类 ID 非法')
    return category
  })
}

function parseFavoriteToggle(value: unknown): FavoriteToggleRequest {
  if (typeof value !== 'object' || value === null) throw new Error('收藏参数非法')
  const payload = value as Record<string, unknown>
  if (typeof payload.favorite !== 'boolean') throw new Error('缺少 favorite')
  return {
    origin: parseOrigin(payload.origin),
    name: requiredString(payload.name, '技能名称', 80),
    favorite: payload.favorite,
    categories: parseCategories(payload.categories),
    snapshot: typeof payload.snapshot === 'object' && payload.snapshot !== null
      ? payload.snapshot as FavoriteToggleRequest['snapshot']
      : undefined,
  }
}

function parseFavoriteUpdate(value: unknown): FavoriteUpdateRequest {
  if (typeof value !== 'object' || value === null) throw new Error('收藏参数非法')
  const payload = value as Record<string, unknown>
  return {
    key: requiredString(payload.key, '收藏键'),
    categories: parseCategories(payload.categories),
    note: optionalString(payload.note, '备注'),
    displayName: optionalString(payload.displayName, '显示名称'),
  }
}

function parseCategory(value: unknown): FavoriteCategoryRequest {
  if (typeof value !== 'object' || value === null) throw new Error('分类参数非法')
  const payload = value as Record<string, unknown>
  return {
    id: optionalString(payload.id, '分类 ID'),
    name: requiredString(payload.name, '分类名称'),
    icon: optionalString(payload.icon, '图标'),
    order: typeof payload.order === 'number' && Number.isFinite(payload.order) ? payload.order : undefined,
  }
}

function parsePresetItem(value: unknown, index: number): PresetItem {
  if (typeof value !== 'object' || value === null) throw new Error(`预设第 ${index + 1} 项非法`)
  const item = value as Record<string, unknown>
  return {
    key: requiredString(item.key, '预设项 key'),
    name: requiredString(item.name, '预设项名称'),
    origin: parseOrigin(item.origin),
    installName: requiredString(item.installName, '安装名称'),
    enabled: item.enabled !== false,
  }
}

function parsePresetSave(value: unknown): PresetSaveRequest {
  if (typeof value !== 'object' || value === null) throw new Error('预设参数非法')
  const payload = value as Record<string, unknown>
  if (!Array.isArray(payload.items) || payload.items.length === 0) throw new Error('预设至少需要一个技能')
  if (payload.items.length > 500) throw new Error('预设最多 500 个技能')
  return {
    id: optionalString(payload.id, '预设 ID'),
    name: requiredString(payload.name, '预设名称'),
    description: optionalString(payload.description, '预设描述'),
    createdFrom: optionalString(payload.createdFrom, '创建来源'),
    defaultTarget: typeof payload.defaultTarget === 'object' && payload.defaultTarget !== null
      ? payload.defaultTarget as PresetTarget
      : undefined,
    applyMode: payload.applyMode === 'exact' ? 'exact' : 'additive',
    installMode: payload.installMode === 'symlink' ? 'symlink' : 'copy',
    items: payload.items.map(parsePresetItem),
  }
}

function parsePresetApply(value: unknown): PresetApplyRequest {
  if (typeof value !== 'object' || value === null) throw new Error('应用预设参数非法')
  const payload = value as Record<string, unknown>
  if (typeof payload.target !== 'object' || payload.target === null) throw new Error('缺少应用目标')
  const target = payload.target as Record<string, unknown>
  if (target.kind !== 'global' && target.kind !== 'project' && target.kind !== 'custom') throw new Error('应用目标类型非法')
  const selectedKeys = Array.isArray(payload.selectedKeys)
    ? payload.selectedKeys.map((key) => {
        if (typeof key !== 'string' || key.length > 1000) throw new Error('预设选择项非法')
        return key
      })
    : undefined
  return {
    presetId: requiredString(payload.presetId, '预设 ID'),
    target: {
      kind: target.kind,
      scopeId: optionalString(target.scopeId, 'scopeId'),
      path: optionalString(target.path, '目标路径'),
      asSkillsRoot: target.asSkillsRoot === true,
    },
    mode: payload.mode === 'exact' ? 'exact' : payload.mode === 'additive' ? 'additive' : undefined,
    selectedKeys,
    registerProject: payload.registerProject === true,
  }
}

export function registerSkillManagerHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  configureProjectRegistryProvider(() => readProjectRegistry(getDefaultProjectRegistryPath()).projects)
  configureSourceAuthProvider((parsed) => {
    const settings = readSkillManagerSettings(getDefaultSkillManagerSettingsPath())
    return {
      token: getSkillManagerToken(parsed.host),
      timeoutMs: settings.networkTimeoutMs,
    }
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.GET_OVERVIEW, async () => {
    return toOverview(await scanInventoryWithDisabled())
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.SCAN, async (_event, value: unknown) => {
    const inventory = await scanInventoryWithDisabled()
    const scopeId = optionalScopeId(value)
    if (!scopeId) return inventory
    return {
      ...inventory,
      scopes: inventory.scopes.filter(scope => scope.scope.id === scopeId),
    } satisfies Inventory
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.LIST_SKILLS, async (_event, value: unknown) => {
    const filter = parseListFilter(value)
    const inventory = await scanInventoryWithDisabled()
    return inventory.scopes
      .filter(scope => !filter.scopeId || scope.scope.id === filter.scopeId)
      .flatMap(scope => scope.skills)
      .filter(skill => !filter.state || skill.state === filter.state)
      .filter(skill => !filter.groupKey || `${skill.origin.sourceType}:${skill.origin.source}@${skill.origin.ref ?? ''}` === filter.groupKey)
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.READ_SKILL, async (_event, value: unknown) => {
    const { scopeId, name } = parseSkillPayload(value)
    return readSkill(scopeId, name)
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.RESOLVE_SOURCE, async (_event, value: unknown) => {
    const { input, ref } = parseResolvePayload(value)
    return resolveSource(input, ref)
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.REPO_CATALOG, async (_event, value: unknown) => {
    const { scopeId, groupKey } = parseRepoCatalogPayload(value)
    return getRepoCatalog(scopeId, groupKey)
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.INSTALL_SKILLS, async (_event, value: unknown) => {
    return installSkills(parseInstallPayload(value))
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.PROJECTS_LIST, async () => {
    return readProjectRegistry(getDefaultProjectRegistryPath()).projects
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.PROJECTS_ADD, async (_event, value: unknown) => {
    if (typeof value !== 'object' || value === null) throw new Error('项目参数非法')
    const path = requiredString((value as Record<string, unknown>).path, '项目路径', 4096)
    return registerProject(path, getDefaultProjectRegistryPath())
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.PROJECTS_REMOVE, async (_event, value: unknown) => {
    if (typeof value !== 'object' || value === null) throw new Error('项目参数非法')
    const id = requiredString((value as Record<string, unknown>).id, '项目 ID', 200)
    await unregisterProject(id, getDefaultProjectRegistryPath())
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.PROJECTS_RESCAN, async (_event, value: unknown) => {
    if (typeof value !== 'object' || value === null) throw new Error('项目参数非法')
    const id = requiredString((value as Record<string, unknown>).id, '项目 ID', 200)
    return rescanProject(id, getDefaultProjectRegistryPath())
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.SET_ENABLED, async (_event, value: unknown) => {
    return setSkillEnabled(parseSetEnabledPayload(value))
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.TRASH_LIST, async () => {
    const settings = readSkillManagerSettings(getDefaultSkillManagerSettingsPath())
    return listTrash(getDefaultTrashRoot(), settings)
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.TRASH_RESTORE, async (_event, value: unknown) => {
    const { operationId, name } = parseTrashPayload(value)
    return restoreTrashItem(getDefaultTrashRoot(), operationId, name)
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.TRASH_DELETE, async (_event, value: unknown) => {
    const { operationId, name } = parseTrashPayload(value)
    return deleteTrashItem(getDefaultTrashRoot(), operationId, name)
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.TRASH_CLEAR, async () => {
    return clearTrash(getDefaultTrashRoot())
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.SETTINGS_GET, async () => {
    return readSkillManagerSettings(getDefaultSkillManagerSettingsPath())
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.SETTINGS_UPDATE, async (_event, value: unknown) => {
    if (typeof value !== 'object' || value === null) throw new Error('设置参数非法')
    const path = getDefaultSkillManagerSettingsPath()
    const settings = normalizeSkillManagerSettings({
      ...readSkillManagerSettings(path),
      ...(value as Partial<SkillManagerSettings>),
    })
    return writeSkillManagerSettings(settings, path)
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.TOKENS_LIST, async () => {
    return listSkillManagerTokens()
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.TOKEN_SAVE, async (_event, value: unknown) => {
    if (typeof value !== 'object' || value === null) throw new Error('令牌参数非法')
    const payload = value as Record<string, unknown>
    const host = requiredString(payload.host, '令牌 host', 500)
    const token = requiredString(payload.token, '令牌', 8192)
    return saveSkillManagerToken(host, token)
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.TOKEN_DELETE, async (_event, value: unknown) => {
    if (typeof value !== 'object' || value === null) throw new Error('令牌参数非法')
    const host = requiredString((value as Record<string, unknown>).host, '令牌 host', 500)
    return deleteSkillManagerToken(host)
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.CHECK_UPDATES, async (_event, value: unknown) => {
    return checkUpdates(parseCheckUpdatesPayload(value))
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.APPLY_PLAN, async (_event, value: unknown) => {
    return applyUpdatePlan(parseApplyPlanPayload(value))
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.UNDO_PLAN, async (_event, value: unknown) => {
    return undoLastPlan(parseUndoPlanPayload(value))
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.FAVORITES_GET, async () => getFavorites())
  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.FAVORITES_TOGGLE, async (_event, value: unknown) => {
    return toggleFavorite(parseFavoriteToggle(value))
  })
  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.FAVORITES_UPDATE, async (_event, value: unknown) => {
    return updateFavoriteItem(parseFavoriteUpdate(value))
  })
  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.FAVORITES_CATEGORY_SAVE, async (_event, value: unknown) => {
    return saveFavoriteCategory(parseCategory(value))
  })
  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.FAVORITES_CATEGORY_DELETE, async (_event, value: unknown) => {
    return deleteFavoriteCategory(requiredString(value, '分类 ID', 60))
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.PRESETS_GET, async () => getPresets())
  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.PRESET_SAVE, async (_event, value: unknown) => {
    return savePresetEntry(parsePresetSave(value))
  })
  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.PRESET_DELETE, async (_event, value: unknown) => {
    return deletePresetEntry(requiredString(value, '预设 ID'))
  })
  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.PRESET_APPLY, async (_event, value: unknown) => {
    return applyPreset(parsePresetApply(value))
  })
  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.PRESETS_IMPORT, async (_event, value: unknown) => {
    return importPresetFile(requiredString(value, '预设 JSON', 5_000_000))
  })
  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.PRESETS_EXPORT, async () => exportPresetFile())

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.REMOVED_LIST, async () => {
    return listRemovedSkills()
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.REMOVED_REINSTALL, async (_event, value: unknown) => {
    const { scopeId, name } = parseSkillPayload(value)
    return reinstallRemovedSkill({ scopeId, name })
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.REMOVED_FORGET, async (_event, value: unknown) => {
    const { scopeId, name } = parseSkillPayload(value)
    await forgetRemovedSkill({ scopeId, name })
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.ADOPT_SKILL, async (_event, value: unknown) => {
    return adoptSkill(parseAdoptPayload(value))
  })

  safeHandle(ipcMain, SKILL_MANAGER_IPC_CHANNELS.DELETE_SKILL, async (_event, value: unknown) => {
    const { scopeId, name } = parseSkillPayload(value)
    return deleteSkill({ scopeId, name })
  })
}
