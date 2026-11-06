import type {
  AdoptRequest,
  AdoptResult,
  ApplyPlanRequest,
  ApplyPlanResult,
  CheckUpdatesRequest,
  DeleteSkillResult,
  FavoriteCategoryRequest,
  FavoritesView,
  FavoriteToggleRequest,
  FavoriteUpdateRequest,
  InstalledSkill,
  InstallResult,
  InstallSkillsRequest,
  Inventory,
  PresetApplyRequest,
  PresetApplyResult,
  PresetSaveRequest,
  PresetsExportResult,
  PresetsFile,
  ProjectRecord,
  ReadSkillResult,
  RemovedSkillsResult,
  RepoCatalog,
  SetEnabledRequest,
  SetEnabledResult,
  SkillManagerOverview,
  SkillManagerSettings,
  SkillState,
  SourceCatalog,
  TokenState,
  TrashClearResult,
  TrashListResult,
  TrashMutationResult,
  UndoPlanRequest,
  UndoPlanResult,
  UpdatePlan,
} from '@shared/skill-manager'
import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'
import { SKILL_MANAGER_CHANNELS } from '@shared/skill-manager'

const { getApi, invoke } = createIpcHelpers('skillManager', '技能管理')

/** 网页预览（无 preload 注入）时返回 null；调用方走只读降级分支。 */
export function getSkillManagerApi() {
  try {
    return getApi()
  } catch {
    return null
  }
}

export function scanSkillManager(scopeId?: string): Promise<Inventory> {
  return invoke<Inventory>(SKILL_MANAGER_CHANNELS.SCAN, scopeId)
}

export function getSkillManagerOverview(): Promise<SkillManagerOverview> {
  return invoke<SkillManagerOverview>(SKILL_MANAGER_CHANNELS.GET_OVERVIEW)
}

export function listSkillManagerSkills(filter: {
  scopeId?: string
  groupKey?: string
  state?: SkillState
} = {}): Promise<InstalledSkill[]> {
  return invoke<InstalledSkill[]>(SKILL_MANAGER_CHANNELS.LIST_SKILLS, filter)
}

export function readSkillFile(scopeId: string, name: string): Promise<ReadSkillResult> {
  return invoke<ReadSkillResult>(SKILL_MANAGER_CHANNELS.READ_SKILL, { scopeId, name })
}

export function resolveSkillSource(input: string, ref?: string): Promise<SourceCatalog> {
  return invoke<SourceCatalog>(SKILL_MANAGER_CHANNELS.RESOLVE_SOURCE, { input, ref })
}

export function getRepoCatalog(scopeId: string, groupKey: string): Promise<RepoCatalog> {
  return invoke<RepoCatalog>(SKILL_MANAGER_CHANNELS.REPO_CATALOG, { scopeId, groupKey })
}
export function installSkillManagerSkills(request: InstallSkillsRequest): Promise<InstallResult> {
  return invoke<InstallResult>(SKILL_MANAGER_CHANNELS.INSTALL_SKILLS, request)
}

export function listSkillManagerProjects(): Promise<ProjectRecord[]> {
  return invoke<ProjectRecord[]>(SKILL_MANAGER_CHANNELS.PROJECTS_LIST)
}

export function addSkillManagerProject(path: string): Promise<ProjectRecord> {
  return invoke<ProjectRecord>(SKILL_MANAGER_CHANNELS.PROJECTS_ADD, { path })
}

export function removeSkillManagerProject(id: string): Promise<void> {
  return invoke<void>(SKILL_MANAGER_CHANNELS.PROJECTS_REMOVE, { id })
}

export function rescanSkillManagerProject(id: string): Promise<ProjectRecord> {
  return invoke<ProjectRecord>(SKILL_MANAGER_CHANNELS.PROJECTS_RESCAN, { id })
}

export function checkSkillManagerUpdates(request: CheckUpdatesRequest): Promise<UpdatePlan> {
  return invoke<UpdatePlan>(SKILL_MANAGER_CHANNELS.CHECK_UPDATES, request)
}

export function applySkillManagerPlan(request: ApplyPlanRequest): Promise<ApplyPlanResult> {
  return invoke<ApplyPlanResult>(SKILL_MANAGER_CHANNELS.APPLY_PLAN, request)
}

export function undoSkillManagerPlan(request: UndoPlanRequest): Promise<UndoPlanResult> {
  return invoke<UndoPlanResult>(SKILL_MANAGER_CHANNELS.UNDO_PLAN, request)
}

export function setSkillManagerEnabled(request: SetEnabledRequest): Promise<SetEnabledResult> {
  return invoke<SetEnabledResult>(SKILL_MANAGER_CHANNELS.SET_ENABLED, request)
}

export function listSkillManagerTrash(): Promise<TrashListResult> {
  return invoke<TrashListResult>(SKILL_MANAGER_CHANNELS.TRASH_LIST)
}

export function restoreSkillManagerTrash(operationId: string, name: string): Promise<TrashMutationResult> {
  return invoke<TrashMutationResult>(SKILL_MANAGER_CHANNELS.TRASH_RESTORE, { operationId, name })
}

export function deleteSkillManagerTrash(operationId: string, name: string): Promise<TrashMutationResult> {
  return invoke<TrashMutationResult>(SKILL_MANAGER_CHANNELS.TRASH_DELETE, { operationId, name })
}

export function clearSkillManagerTrash(): Promise<TrashClearResult> {
  return invoke<TrashClearResult>(SKILL_MANAGER_CHANNELS.TRASH_CLEAR)
}

export function getSkillManagerSettings(): Promise<SkillManagerSettings> {
  return invoke<SkillManagerSettings>(SKILL_MANAGER_CHANNELS.SETTINGS_GET)
}

export function updateSkillManagerSettings(settings: Partial<SkillManagerSettings>): Promise<SkillManagerSettings> {
  return invoke<SkillManagerSettings>(SKILL_MANAGER_CHANNELS.SETTINGS_UPDATE, settings)
}

export function listSkillManagerTokens(): Promise<TokenState> {
  return invoke<TokenState>(SKILL_MANAGER_CHANNELS.TOKENS_LIST)
}

export function saveSkillManagerToken(host: string, token: string): Promise<TokenState> {
  return invoke<TokenState>(SKILL_MANAGER_CHANNELS.TOKEN_SAVE, { host, token })
}

export function deleteSkillManagerToken(host: string): Promise<TokenState> {
  return invoke<TokenState>(SKILL_MANAGER_CHANNELS.TOKEN_DELETE, { host })
}

export function getSkillManagerFavorites(): Promise<FavoritesView> {
  return invoke<FavoritesView>(SKILL_MANAGER_CHANNELS.FAVORITES_GET)
}

export function toggleSkillManagerFavorite(request: FavoriteToggleRequest): Promise<FavoritesView> {
  return invoke<FavoritesView>(SKILL_MANAGER_CHANNELS.FAVORITES_TOGGLE, request)
}

export function updateSkillManagerFavorite(request: FavoriteUpdateRequest): Promise<FavoritesView> {
  return invoke<FavoritesView>(SKILL_MANAGER_CHANNELS.FAVORITES_UPDATE, request)
}

export function saveSkillManagerFavoriteCategory(request: FavoriteCategoryRequest): Promise<FavoritesView> {
  return invoke<FavoritesView>(SKILL_MANAGER_CHANNELS.FAVORITES_CATEGORY_SAVE, request)
}

export function deleteSkillManagerFavoriteCategory(id: string): Promise<FavoritesView> {
  return invoke<FavoritesView>(SKILL_MANAGER_CHANNELS.FAVORITES_CATEGORY_DELETE, id)
}

export function getSkillManagerPresets(): Promise<PresetsFile> {
  return invoke<PresetsFile>(SKILL_MANAGER_CHANNELS.PRESETS_GET)
}

export function saveSkillManagerPreset(request: PresetSaveRequest): Promise<PresetsFile> {
  return invoke<PresetsFile>(SKILL_MANAGER_CHANNELS.PRESET_SAVE, request)
}

export function deleteSkillManagerPreset(id: string): Promise<PresetsFile> {
  return invoke<PresetsFile>(SKILL_MANAGER_CHANNELS.PRESET_DELETE, id)
}

export function applySkillManagerPreset(request: PresetApplyRequest): Promise<PresetApplyResult> {
  return invoke<PresetApplyResult>(SKILL_MANAGER_CHANNELS.PRESET_APPLY, request)
}

export function importSkillManagerPresets(raw: string): Promise<PresetsFile> {
  return invoke<PresetsFile>(SKILL_MANAGER_CHANNELS.PRESETS_IMPORT, raw)
}

export function exportSkillManagerPresets(): Promise<PresetsExportResult> {
  return invoke<PresetsExportResult>(SKILL_MANAGER_CHANNELS.PRESETS_EXPORT)
}

export function listSkillManagerRemoved(): Promise<RemovedSkillsResult> {
  return invoke<RemovedSkillsResult>(SKILL_MANAGER_CHANNELS.REMOVED_LIST)
}

export function reinstallSkillManagerRemoved(scopeId: string, name: string): Promise<InstallResult> {
  return invoke<InstallResult>(SKILL_MANAGER_CHANNELS.REMOVED_REINSTALL, { scopeId, name })
}

export function forgetSkillManagerRemoved(scopeId: string, name: string): Promise<void> {
  return invoke<void>(SKILL_MANAGER_CHANNELS.REMOVED_FORGET, { scopeId, name })
}

export function adoptSkillManagerSkill(request: AdoptRequest): Promise<AdoptResult> {
  return invoke<AdoptResult>(SKILL_MANAGER_CHANNELS.ADOPT_SKILL, request)
}

export function deleteSkillManagerSkill(scopeId: string, name: string): Promise<DeleteSkillResult> {
  return invoke<DeleteSkillResult>(SKILL_MANAGER_CHANNELS.DELETE_SKILL, { scopeId, name })
}
