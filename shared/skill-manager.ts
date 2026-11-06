// 技能管理器的纯类型与锁格式常量。
// 只依赖 TypeScript 类型，不依赖 Electron / Node / 文件系统，便于前后端共用与单测。

export type SkillSourceType = 'github' | 'git' | 'local' | 'node_modules' | 'well-known' | 'unknown'

export interface SkillOrigin {
  sourceType: SkillSourceType
  source: string
  sourceUrl?: string
  ref?: string | null
  skillPath?: string
}

export type SkillState
  = | 'ok'
    | 'update-available'
    | 'modified'
    | 'missing'
    | 'orphan'
    | 'invalid'
    | 'removed-upstream'
    | 'removed-external'
    | 'moved'
    | 'disabled'
    | 'disabled-drift'
    | 'linked'
    | 'legacy'
    | 'shadowed'
    | 'unknown'

export type ScopeKind = 'global' | 'project'

export interface Scope {
  id: string
  kind: ScopeKind
  label: string
  skillsDir: string
  lockPath: string
  projectPath?: string
  lockState: 'ok' | 'missing' | 'invalid' | 'unsupported'
  lockVersion?: number
}

export interface InstalledSkill {
  key: string
  name: string
  dirName: string
  scopeId: string
  origin: SkillOrigin
  state: SkillState
  stateReasons: string[]
  installMode: 'copy' | 'symlink'
  linkTarget?: string
  contentHash?: string
  baselineHash?: string
  localModified: boolean
  disabled: boolean
  tracked: boolean
  forked: boolean
  lockManaged?: boolean
  installedAt?: string
  updatedAt?: string
  sizeBytes?: number
  /** 以下为扫描器补充的展示字段 */
  description?: string
  category?: string
  skillPath?: string
  frontmatterName?: string
}

export interface RepoGroupView {
  key: string
  scopeId: string
  origin: Pick<SkillOrigin, 'sourceType' | 'source' | 'ref' | 'sourceUrl'>
  displayName: string
  host: string
  orphan: boolean
  skills: InstalledSkill[]
  counts: {
    remoteTotal: number
    selected: number
    installed: number
    ok: number
    update: number
    modified: number
    removed: number
    missing: number
    orphan: number
    linked: number
    invalid: number
    disabled: number
  }
  lastCheckedAt?: string
  lastFetchedCount?: number
  resolvedRef?: string
}

export interface ScanDiagnostic {
  level: 'info' | 'warning'
  code: string
  message: string
  scopeId: string
  name?: string
}

export interface ScanSummary {
  total: number
  onDisk: number
  tracked: number
  untracked: number
  ok: number
  update: number
  modified: number
  missing: number
  orphan: number
  linked: number
  invalid: number
  disabled: number
  issueCount: number
}

export interface ScopeInventory {
  scope: Scope
  groups: RepoGroupView[]
  skills: InstalledSkill[]
  removed: RemovedSkillView[]
  diagnostics: ScanDiagnostic[]
  summary: ScanSummary
}

export interface Inventory {
  scannedAt: string
  scopes: ScopeInventory[]
}

export interface SkillManagerOverview {
  scannedAt: string
  totalSkills: number
  issueCount: number
  scopes: Array<{
    scope: Scope
    summary: ScanSummary
    groupCount: number
  }>
}

export interface SkillFileNode {
  name: string
  path: string
  type: 'file' | 'dir' | 'link'
  size?: number
  children?: SkillFileNode[]
}

export interface ReadSkillResult {
  name: string
  markdown: string
  files: SkillFileNode[]
  truncated: boolean
}

/** 远端/本地来源里的一个技能；只描述目录，不代表已安装。 */
export interface SourceCatalogEntry {
  name: string
  skillPath: string
  description?: string
  folderSha?: string
}

/** 一次来源解析的结果；只读，不包含下载产物。 */
export interface SourceCatalog {
  sourceType: SkillSourceType
  source: string
  sourceUrl?: string
  ref?: string | null
  resolvedRef: string
  commitSha?: string
  displayName: string
  host: string
  rootSkill: boolean
  total: number
  entries: SourceCatalogEntry[]
  fetchedAt: string
  warnings: string[]
}

/** 已安装仓库组的目录视图：远端条目 + 本地状态。 */
export interface RepoCatalogEntry extends SourceCatalogEntry {
  localState?: SkillState
  selected: boolean
  updateAvailable: boolean
}

export interface RepoCatalog extends Omit<SourceCatalog, 'entries'> {
  groupKey: string
  entries: RepoCatalogEntry[]
}

export interface ResolveSourceRequest {
  input: string
  ref?: string
}

export interface RepoCatalogRequest {
  scopeId: string
  groupKey: string
}

export type PlanAction
  = | 'update'
    | 'add'
    | 'install'
    | 'remove'
    | 'move'
    | 'reinstall'
    | 'conflict'
    | 'ambiguous'
    | 'unknown'
    | 'skip'

/** 一次更新检查里的单个技能动作；不落盘到项目。 */
export interface PlanItem {
  name: string
  action: PlanAction
  fromPath?: string
  toPath?: string
  fromFolderSha?: string
  toFolderSha?: string
  localModified: boolean
  selectedByDefault: boolean
  reasons: string[]
}

export interface UpdatePlan {
  id: string
  kind: 'update'
  scopeId: string
  groupKey: string
  createdAt: string
  resolvedRef: string
  commitSha?: string
  items: PlanItem[]
  summary: Record<PlanAction, number>
  warnings: string[]
}

export interface CheckUpdatesRequest {
  scopeId: string
  groupKey: string
}

export interface ApplyPlanRequest {
  planId: string
  /** 本次要执行的技能名；服务端只接受计划里可执行的动作。 */
  names: string[]
}

export interface ApplyPlanResult {
  operationId: string
  planId: string
  applied: string[]
  updated: string[]
  removed: string[]
  skipped: string[]
  lockPath: string
  trashRef?: string
  historyId: string
  warnings: string[]
}

export interface UndoPlanRequest {
  scopeId: string
  historyId?: string
}

export interface UndoPlanResult {
  historyId: string
  restored: string[]
  lockPath: string
  warnings: string[]
}

export interface SkillManagerTrashRecord {
  name: string
  sourcePath: string
  trashPath: string
}

export const SKILL_MANAGER_CHANNELS = {
  GET_OVERVIEW: 'skill-manager:get-overview',
  SCAN: 'skill-manager:scan',
  LIST_SKILLS: 'skill-manager:list-skills',
  READ_SKILL: 'skill-manager:read-skill',
  RESOLVE_SOURCE: 'skill-manager:resolve-source',
  REPO_CATALOG: 'skill-manager:repo-catalog',
  INSTALL_SKILLS: 'skill-manager:install-skills',
  PROJECTS_LIST: 'skill-manager:projects-list',
  PROJECTS_ADD: 'skill-manager:projects-add',
  PROJECTS_REMOVE: 'skill-manager:projects-remove',
  PROJECTS_RESCAN: 'skill-manager:projects-rescan',
  CHECK_UPDATES: 'skill-manager:check-updates',
  APPLY_PLAN: 'skill-manager:apply-plan',
  UNDO_PLAN: 'skill-manager:undo-plan',
  SET_ENABLED: 'skill-manager:set-enabled',
  TRASH_LIST: 'skill-manager:trash-list',
  TRASH_RESTORE: 'skill-manager:trash-restore',
  TRASH_DELETE: 'skill-manager:trash-delete',
  TRASH_CLEAR: 'skill-manager:trash-clear',
  SETTINGS_GET: 'skill-manager:settings-get',
  SETTINGS_UPDATE: 'skill-manager:settings-update',
  TOKENS_LIST: 'skill-manager:tokens-list',
  TOKEN_SAVE: 'skill-manager:token-save',
  TOKEN_DELETE: 'skill-manager:token-delete',
  FAVORITES_GET: 'skill-manager:favorites-get',
  FAVORITES_TOGGLE: 'skill-manager:favorites-toggle',
  FAVORITES_UPDATE: 'skill-manager:favorites-update',
  FAVORITES_CATEGORY_SAVE: 'skill-manager:favorites-category-save',
  FAVORITES_CATEGORY_DELETE: 'skill-manager:favorites-category-delete',
  PRESETS_GET: 'skill-manager:presets-get',
  PRESET_SAVE: 'skill-manager:preset-save',
  PRESET_DELETE: 'skill-manager:preset-delete',
  PRESET_APPLY: 'skill-manager:preset-apply',
  PRESETS_IMPORT: 'skill-manager:presets-import',
  PRESETS_EXPORT: 'skill-manager:presets-export',
  REMOVED_LIST: 'skill-manager:removed-list',
  REMOVED_REINSTALL: 'skill-manager:removed-reinstall',
  REMOVED_FORGET: 'skill-manager:removed-forget',
  ADOPT_SKILL: 'skill-manager:adopt-skill',
  DELETE_SKILL: 'skill-manager:delete-skill',
} as const

export const PROJECT_LOCK_VERSION = 1
export const GLOBAL_LOCK_VERSION = 3

/** 项目 skills-lock.json 的单条记录；未知字段原样保留，写回时不能丢。 */
export interface ProjectLockEntry {
  source: string
  sourceType: string
  sourceUrl?: string
  ref?: string
  skillPath?: string
  computedHash: string
  version?: string
  via?: string
  installMode?: 'copy'
  subagents?: string[]
  wellKnownDigest?: string
  [key: string]: unknown
}

export interface ProjectLockFile {
  version: number
  skills: Record<string, ProjectLockEntry>
  [key: string]: unknown
}

/** 全局 .skill-lock.json v3 的单条记录。 */
export interface GlobalLockEntry {
  source: string
  sourceType: string
  sourceUrl?: string
  ref?: string
  skillPath?: string
  skillFolderHash: string
  installedAt: string
  updatedAt: string
  pluginName?: string
  sourceBaseUrl?: string
  wellKnownDigest?: string
  installMode?: 'copy'
  [key: string]: unknown
}

export interface GlobalLockFile {
  version: number
  skills: Record<string, GlobalLockEntry>
  dismissed?: Record<string, unknown>
  lastSelectedAgents?: string[]
  [key: string]: unknown
}

export type LockFailureReason = 'invalid' | 'unsupported' | 'io'

export interface LockReadSuccess<T> {
  ok: true
  path: string
  exists: boolean
  raw: string
  data: T
}

export interface LockReadFailure {
  ok: false
  path: string
  reason: LockFailureReason
  message: string
  version?: number
  raw?: string
}

export type LockReadResult<T> = LockReadSuccess<T> | LockReadFailure

export function emptyProjectLock(): ProjectLockFile {
  return { version: PROJECT_LOCK_VERSION, skills: {} }
}

export function emptyGlobalLock(): GlobalLockFile {
  return { version: GLOBAL_LOCK_VERSION, skills: {} }
}

/** 安装请求：本步骤只支持全局 scope；names 必须来自同一次来源解析。 */
export interface InstallSkillsRequest {
  input: string
  ref?: string
  names: string[]
  scopeId?: string
  /** 目标项目根目录；提供时安装到 <project>/.agents/skills 并写项目锁。 */
  projectPath?: string
}

export type InstallConflictReason
  = | 'different-source'
    | 'untracked-target'
    | 'symlink-target'
    | 'invalid-name'
    | 'duplicate-name'
    | 'ambiguous-name'
    | 'scope-unsupported'

export interface InstallConflict {
  name: string
  reason: InstallConflictReason
  message: string
  existingSource?: string
  incomingSource?: string
}

export interface InstallResult {
  operationId: string
  scopeId: string
  status: 'ok' | 'conflict'
  installed: string[]
  updated: string[]
  conflicts: InstallConflict[]
  warnings: string[]
  lockPath: string
  registryPath: string
  trashRef?: string
}

export interface SkillManagerBaseline {
  contentHash: string
  capturedAt: string
  source: 'install' | 'adopt' | 'repair'
}

export interface SkillManagerRemote {
  folderSha?: string
  resolvedRef?: string
  commitSha?: string
  fetchedAt: string
}

export interface SkillManagerRecord {
  name: string
  dirName: string
  origin: SkillOrigin
  installMode: 'copy' | 'symlink'
  baseline: SkillManagerBaseline
  remote: SkillManagerRemote
  tracked: boolean
  forked: boolean
  /** false = 本地接管，不写锁、不参与远端更新 */
  lockManaged?: boolean
  state: 'installed' | 'removed'
  installedAt: string
  updatedAt: string
  removedAt?: string | null
  removedReason?: 'uninstall' | 'removed-upstream' | 'external' | null
  trashRef?: string | null
  disabledAt?: string | null
  disabledPath?: string | null
}

export type RemovedReason = 'uninstall' | 'removed-upstream' | 'external'

/** 仅用于「已移除」视图；不进入技能库/更新计划。 */
export interface RemovedSkillView {
  scopeId: string
  name: string
  dirName: string
  origin: SkillOrigin
  removedAt: string
  removedReason: RemovedReason
  trashRef?: string
  lastKnownBaseline?: string
}

export interface RemovedSkillsResult {
  items: RemovedSkillView[]
}

export interface AdoptRequest {
  scopeId: string
  name: string
  mode: 'source' | 'local'
  /** mode=source 时必填；local 接管不需要 */
  input?: string
  ref?: string
  skillPath?: string
}

export interface AdoptResult {
  scopeId: string
  name: string
  mode: 'source' | 'local'
  lockManaged: boolean
  origin: SkillOrigin
  installedAt: string
  lockPath?: string
  warnings: string[]
}

export interface DeleteSkillRequest {
  scopeId: string
  name: string
}

export interface DeleteSkillResult {
  scopeId: string
  name: string
  operationId: string
  trashRef: string
}

export interface ForgetRemovedRequest {
  scopeId: string
  name: string
}

export interface ReinstallRemovedRequest {
  scopeId: string
  name: string
}

export interface SkillManagerGroupRecord {
  lastCheckedAt?: string
  lastFetchedAt?: string
  resolvedRef?: string
  commitSha?: string
  selectedNames: string[]
  installedNames: string[]
  disabledNames: string[]
  lastFetchedNames: string[]
  lastPlanId?: string
  lastPlanSummary?: Record<string, number>
}

export interface SkillManagerScopeRegistry {
  lastScanAt?: string
  lockFingerprint?: string
  records: Record<string, SkillManagerRecord>
}

export interface SkillManagerRegistry {
  version: 1
  scopes: Record<string, SkillManagerScopeRegistry>
  groups: Record<string, SkillManagerGroupRecord>
}

export interface ProjectRecord {
  id: string
  name: string
  path: string
  addedAt: string
  lastScanAt?: string
  enabled: boolean
}

export interface ProjectRegistry {
  version: 1
  projects: ProjectRecord[]
}

export interface SkillManagerHistoryEntry {
  id: string
  at: string
  action: 'install' | 'update' | 'uninstall' | 'adopt' | 'disable' | 'enable' | 'trash-restore' | 'trash-delete' | 'preset-apply'
  scopeId: string
  operationId: string
  names: string[]
  status: 'ok' | 'failed'
  detail?: string
  planId?: string
  groupKey?: string
  beforeLockRaw?: string
  afterLockFingerprint?: string
  trashRef?: string
  trashEntries?: SkillManagerTrashRecord[]
  updatedNames?: string[]
  removedNames?: string[]
  undoneAt?: string
}

export interface SkillManagerHistoryFile {
  version: 1
  entries: SkillManagerHistoryEntry[]
}

/** 禁用区索引：每个 scope 一份，目录名已做文件系统安全化。 */
export interface SkillManagerDisabledEntry {
  name: string
  scopeId: string
  groupKey?: string
  origin: SkillOrigin
  installMode: 'copy' | 'symlink'
  linkTarget?: string
  contentHash?: string
  disabledAt: string
  /** 原锁条目，启用时用于字节级语义恢复（未知字段一并保留）。 */
  lockEntry?: Record<string, unknown>
}

export interface SkillManagerDisabledIndex {
  version: 1
  scopeId: string
  entries: Record<string, SkillManagerDisabledEntry>
}

export interface SetEnabledRequest {
  scopeId: string
  names: string[]
  enabled: boolean
}

export interface SetEnabledResult {
  operationId: string
  scopeId: string
  enabled: string[]
  disabled: string[]
  warnings: string[]
  lockPath: string
  disabledRoot: string
  historyId: string
}

export interface TrashItemView {
  operationId: string
  scopeId: string
  reason: string
  createdAt: string
  name: string
  sourcePath: string
  trashPath: string
  origin?: SkillOrigin
  contentHash?: string
  sizeBytes: number
  ageDays: number
  restorable: boolean
}

export interface TrashListResult {
  root: string
  items: TrashItemView[]
  totalBytes: number
  retentionDays: number
  maxBytes: number
}

export interface TrashMutationResult {
  operationId: string
  name: string
  restored?: boolean
  deleted?: boolean
  targetPath?: string
  warnings: string[]
}

export interface TrashClearResult {
  removed: number
  freedBytes: number
}

export interface SkillManagerSettings {
  autoReDisable: boolean
  trashRetentionDays: number
  trashMaxBytes: number
  disabledLockPolicy: 'delete' | 'keep'
  defaultUpdatePolicy: 'safe' | 'sync'
  autoCheckIntervalHours: number
  removePolicy: 'trash' | 'keep'
  networkTimeoutMs: number
}

/** 已保存令牌的脱敏视图：绝不把明文或密文送回渲染层。 */
export interface TokenHostView {
  host: string
  updatedAt: string
  sealed: boolean
}

export interface TokenState {
  hosts: TokenHostView[]
}

export interface TokenSaveRequest {
  host: string
  token: string
}

/** 收藏/预设的稳定来源键：同一仓库内不同 skillPath 必须区分。 */
export function skillOriginKey(origin: SkillOrigin): string {
  const ref = origin.ref ? `@${origin.ref}` : ''
  const path = origin.skillPath ? `#${origin.skillPath}` : ''
  return `${origin.sourceType}:${origin.source}${ref}${path}`
}

export interface FavoriteCategory {
  id: string
  name: string
  icon?: string
  order: number
  builtin?: boolean
}

export interface FavoriteSnapshot {
  description?: string
  category?: string
  scopeId?: string
  state?: SkillState
}

export interface FavoriteItem {
  id: string
  name: string
  displayName?: string
  origin: SkillOrigin
  categories: string[]
  note?: string
  createdAt: string
  lastSeenAt?: string
  snapshot?: FavoriteSnapshot
}

export interface FavoritesFile {
  version: 1
  categories: FavoriteCategory[]
  /** key = skillOriginKey(origin) */
  items: Record<string, FavoriteItem>
}

export interface FavoriteViewItem extends FavoriteItem {
  key: string
  installed: boolean
  scopeIds: string[]
  state?: SkillState
}

export interface FavoritesView {
  file: FavoritesFile
  items: FavoriteViewItem[]
}

export interface FavoriteToggleRequest {
  origin: SkillOrigin
  name: string
  favorite: boolean
  categories?: string[]
  snapshot?: FavoriteSnapshot
}

export interface FavoriteUpdateRequest {
  key: string
  categories?: string[]
  note?: string
  displayName?: string
}

export interface FavoriteCategoryRequest {
  id?: string
  name: string
  icon?: string
  order?: number
}

export type PresetTargetKind = 'global' | 'project' | 'custom'

export interface PresetTarget {
  kind: PresetTargetKind
  scopeId?: string
  path?: string
  /** true 表示把 path 直接当技能根；默认 false，落到 <path>/.agents/skills。 */
  asSkillsRoot?: boolean
}

export interface PresetItem {
  /** skillOriginKey(origin) */
  key: string
  name: string
  origin: SkillOrigin
  installName: string
  enabled: boolean
}

export interface Preset {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  createdFrom: string
  defaultTarget: PresetTarget
  applyMode: 'additive' | 'exact'
  installMode: 'copy' | 'symlink'
  items: PresetItem[]
  lastAppliedAt?: string
  lastApplyTarget?: PresetTarget
}

export interface PresetsFile {
  version: 1
  presets: Record<string, Preset>
}

export interface PresetSaveRequest {
  id?: string
  name: string
  description?: string
  createdFrom?: string
  defaultTarget?: PresetTarget
  applyMode?: 'additive' | 'exact'
  installMode?: 'copy' | 'symlink'
  items: PresetItem[]
}

export interface PresetApplyRequest {
  presetId: string
  target: PresetTarget
  mode?: 'additive' | 'exact'
  selectedKeys?: string[]
  registerProject?: boolean
}

export type PresetApplyItemAction = 'install' | 'update' | 'skip' | 'remove' | 'conflict' | 'unavailable'

export interface PresetApplyItem {
  key: string
  name: string
  action: PresetApplyItemAction
  message?: string
}

export interface PresetApplyResult {
  operationId: string
  presetId: string
  target: PresetTarget
  mode: 'additive' | 'exact'
  status: 'ok' | 'partial' | 'conflict'
  installed: string[]
  updated: string[]
  removed: string[]
  skipped: string[]
  unavailable: string[]
  conflicts: InstallConflict[]
  warnings: string[]
  items: PresetApplyItem[]
  lockPath?: string
  projectId?: string
}

export interface PresetsExportResult {
  raw: string
  count: number
}

export interface PresetsImportRequest {
  raw: string
}
