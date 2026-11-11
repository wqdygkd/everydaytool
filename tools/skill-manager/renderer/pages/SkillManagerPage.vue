<script setup lang="ts">
import type { ApplyPlanResult, FavoritesView, FavoriteViewItem, InstalledSkill, InstallResult, PlanItem, Preset, PresetApplyResult, PresetItem, PresetsFile, ProjectRecord, RemovedSkillView, RepoGroupView, ScopeInventory, SkillManagerSettings, SkillState, SourceCatalog, TokenState, TrashItemView, TrashListResult, UndoPlanResult, UpdatePlan } from '@shared/skill-manager'
import type { IconName } from '../../../../renderer/shared/components/ui/icons'
import { useToolPaneActive } from '@renderer/shared/components/ui/overlay-target'
import { useToolPath } from '@renderer/shared/composables/useToolPath'
import { confirm } from '@renderer/shared/feedback'
import { skillOriginKey } from '@shared/skill-manager'
import { toast } from 'vue-sonner'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import WorkspaceSpine from '../../../../renderer/shared/components/workspace/WorkspaceSpine.vue'
import UpdatePlanPanel from '../components/UpdatePlanPanel.vue'
import { addSkillManagerProject, adoptSkillManagerSkill, applySkillManagerPlan, applySkillManagerPreset, checkSkillManagerUpdates, clearSkillManagerTrash, deleteSkillManagerPreset, deleteSkillManagerSkill, deleteSkillManagerToken, deleteSkillManagerTrash, exportSkillManagerPresets, forgetSkillManagerRemoved, getSkillManagerFavorites, getSkillManagerPresets, getSkillManagerSettings, importSkillManagerPresets, installSkillManagerSkills, listSkillManagerProjects, listSkillManagerRemoved, listSkillManagerTokens, listSkillManagerTrash, reinstallSkillManagerRemoved, removeSkillManagerProject, rescanSkillManagerProject, resolveSkillSource, restoreSkillManagerTrash, saveSkillManagerPreset, saveSkillManagerToken, scanSkillManager, setSkillManagerEnabled, toggleSkillManagerFavorite, undoSkillManagerPlan, updateSkillManagerSettings } from '../ipc'
import { SKILL_MANAGER_TABS, tabKeyFromPath } from '../tabs'

type StateTone = 'neutral' | 'success' | 'warning' | 'danger'
type FilterKey = 'all' | 'update' | 'removed' | 'orphan' | 'disabled'

const STATE_META: Record<SkillState, { label: string, tone: StateTone }> = {
  'ok': { label: '正常', tone: 'success' },
  'update-available': { label: '可更新', tone: 'warning' },
  'modified': { label: '本地已修改', tone: 'warning' },
  'missing': { label: '目录缺失', tone: 'danger' },
  'orphan': { label: '未托管', tone: 'neutral' },
  'invalid': { label: '无效', tone: 'danger' },
  'removed-upstream': { label: '上游已移除', tone: 'danger' },
  'removed-external': { label: '外部删除', tone: 'neutral' },
  'moved': { label: '已移动', tone: 'warning' },
  'disabled': { label: '已禁用', tone: 'neutral' },
  'disabled-drift': { label: '禁用区冲突', tone: 'warning' },
  'linked': { label: '链接安装', tone: 'neutral' },
  'legacy': { label: '旧锁记录', tone: 'warning' },
  'shadowed': { label: '被遮蔽', tone: 'warning' },
  'unknown': { label: '未知', tone: 'neutral' },
}

const router = useRouter()
const toolPath = useToolPath()
const paneActive = useToolPaneActive()
const activeTab = computed(() => tabKeyFromPath(toolPath.value))
const inventory = ref<Awaited<ReturnType<typeof scanSkillManager>> | null>(null)
const loading = ref(true)
const error = ref('')
const search = ref('')
const statusFilter = ref<FilterKey>('all')
const activeScopeId = ref('')
const collapsed = ref<Record<string, boolean>>({})
const favoritesView = ref<FavoritesView | null>(null)
const favoriteFilter = ref('all')
const presetsFile = ref<PresetsFile | null>(null)
const presetCreateOpen = ref(false)
const presetName = ref('')
const presetDescription = ref('')
const presetDraftItems = ref<PresetItem[]>([])
const presetCreateMode = ref<'additive' | 'exact'>('additive')
const presetSaving = ref(false)
const presetApplyOpen = ref(false)
const presetApplyId = ref('')
const presetApplyTarget = ref<'global' | 'project' | 'custom'>('global')
const presetApplyPath = ref('')
const presetApplyMode = ref<'additive' | 'exact'>('additive')
const presetApplyExactAck = ref(false)
const presetApplyRegister = ref(true)
const presetApplying = ref(false)
const presetApplyError = ref('')
const presetApplyResult = ref<PresetApplyResult | null>(null)
const presetImportOpen = ref(false)
const presetImportText = ref('')
const presetImportError = ref('')
const installOpen = ref(false)
const installTarget = ref<'global' | 'project'>('global')
const installSource = ref('')
const installRef = ref('')
const installCatalog = ref<SourceCatalog | null>(null)
const installSelectedNames = ref<Set<string>>(new Set())
const installResolving = ref(false)
const installing = ref(false)
const installError = ref('')
const installResult = ref<InstallResult | null>(null)
const planOpen = ref(false)
const planCheckingGroupKey = ref('')
const planError = ref('')
const plan = ref<UpdatePlan | null>(null)
const planSelected = ref<string[]>([])
const planApplying = ref(false)
const planResult = ref<ApplyPlanResult | null>(null)
const planUndoResult = ref<UndoPlanResult | null>(null)
const lastPlanHistoryId = ref('')
const planScopeId = ref('')
const trashOpen = ref(false)
const trashLoading = ref(false)
const trashError = ref('')
const trash = ref<TrashListResult | null>(null)
const trashBusyKey = ref('')
const settings = ref<SkillManagerSettings | null>(null)
const settingsBusy = ref(false)
const settingsOpen = ref(false)
const projects = ref<ProjectRecord[]>([])
const projectPathInput = ref('')
const projectBusy = ref(false)
const projectError = ref('')
const tokenState = ref<TokenState | null>(null)
const tokenHost = ref('')
const tokenValue = ref('')
const tokenBusy = ref(false)
const autoChecking = ref(false)
const removedOpen = ref(false)
const removedLoading = ref(false)
const removedError = ref('')
const removed = ref<RemovedSkillView[]>([])
const removedBusyKey = ref('')
const adoptOpen = ref(false)
const adoptTarget = ref<InstalledSkill | null>(null)
const adoptMode = ref<'source' | 'local'>('source')
const adoptInput = ref('')
const adoptRef = ref('')
const adoptPath = ref('')
const adoptBusy = ref(false)
const adoptError = ref('')

const scopes = computed(() => inventory.value?.scopes ?? [])
const activeScope = computed<ScopeInventory | undefined>(() => {
  return scopes.value.find(scope => scope.scope.id === activeScopeId.value) ?? scopes.value[0]
})
const activeGroups = computed<RepoGroupView[]>(() => activeScope.value?.groups ?? [])
const activeSkills = computed<InstalledSkill[]>(() => activeScope.value?.skills ?? [])
const activeSummary = computed(() => activeScope.value?.summary)
const activeRemoved = computed(() => activeScope.value?.removed ?? [])
const projectScope = computed(() => scopes.value.find(scope => scope.scope.kind === 'project'))
const favoriteMap = computed(() => new Map((favoritesView.value?.items ?? []).map(item => [item.key, item])))
const favoriteCategories = computed(() => favoritesView.value?.file.categories ?? [])
const favoriteItems = computed<FavoriteViewItem[]>(() => {
  return (favoritesView.value?.items ?? [])
    .filter(item => favoriteFilter.value === 'all' || item.categories.includes(favoriteFilter.value))
    .filter(item => !search.value || [item.name, item.displayName ?? '', item.origin.source, item.note ?? ''].some(value => value.toLowerCase().includes(search.value.toLowerCase())))
    .sort((a, b) => a.name.localeCompare(b.name))
})
const presetList = computed(() => Object.values(presetsFile.value?.presets ?? {}).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
const projectTargetAvailable = computed(() => Boolean(projectScope.value?.scope.projectPath))

const tabBadges = computed<Record<string, number | undefined>>(() => {
  const scopes = inventory.value?.scopes ?? []
  const project = scopes.find(scope => scope.scope.kind === 'project')
  return {
    installed: project?.summary.total ?? scopes.reduce((total, scope) => total + scope.summary.total, 0),
    updates: scopes.reduce((total, scope) => total + scope.summary.issueCount, 0),
    projects: project ? 1 : 0,
  }
})

const repoCount = computed(() => activeGroups.value.filter(group => !group.orphan).length)

const menuItems = computed(() => SKILL_MANAGER_TABS.map(tab => ({
  key: tab.key,
  label: tab.label,
  count: tabBadges.value[tab.key],
})))

const filterCounts = computed(() => ({
  all: activeSummary.value?.total ?? 0,
  update: activeSummary.value?.update ?? 0,
  removed: activeSkills.value.filter(skill => skill.state === 'removed-upstream').length,
  orphan: activeSummary.value?.orphan ?? 0,
  disabled: activeSummary.value?.disabled ?? 0,
}))

const statusLabel = computed(() => {
  if (loading.value) return '正在扫描…'
  if (autoChecking.value) return '正在后台检查更新…'
  if (error.value) return '扫描失败'
  const scope = activeScope.value
  if (!scope) return '暂无技能'
  return `${scope.summary.total} 个技能 · ${repoCount.value} 个仓库 · ${scope.summary.issueCount} 项待处理`
})

const statusTone = computed<'neutral' | 'success' | 'warning' | 'danger'>(() => {
  if (error.value) return 'danger'
  if (loading.value || autoChecking.value) return 'neutral'
  return (activeSummary.value?.issueCount ?? 0) > 0 ? 'warning' : 'success'
})

const scannedLabel = computed(() => {
  if (!inventory.value?.scannedAt) return '未扫描'
  const time = new Date(inventory.value.scannedAt)
  return `扫描于 ${time.toLocaleTimeString('zh-CN', { hour12: false })}`
})

const visibleGroups = computed(() => {
  return activeGroups.value.filter(group => groupSkills(group).length > 0)
})

const installSelectedCount = computed(() => installSelectedNames.value.size)
const installButtonLabel = computed(() => {
  if (installing.value) return '安装中…'
  return installSelectedCount.value > 0 ? `安装选中（${installSelectedCount.value}）` : '安装选中'
})

const planTitle = computed(() => {
  const group = plan.value
  if (!group) return '更新计划'
  const matched = activeGroups.value.find(item => item.key === group.groupKey)
  return matched ? `${matched.displayName} · 更新计划` : '更新计划'
})

const planSelectedCount = computed(() => planSelected.value.length)
const planCanApply = computed(() => Boolean(plan.value && planSelectedCount.value > 0 && !planApplying.value))
const planCanUndo = computed(() => Boolean(lastPlanHistoryId.value && planResult.value && !planApplying.value))

function openInstallDialog(
  source = '',
  ref = '',
  preselect: string[] = [],
  target: 'global' | 'project' = 'global',
): void {
  installOpen.value = true
  installTarget.value = target
  installSource.value = source
  installRef.value = ref
  installCatalog.value = null
  installSelectedNames.value = new Set(preselect)
  installError.value = ''
  installResult.value = null
  if (source.trim()) void resolveInstallSource(preselect)
}

function openGroupInstall(group: RepoGroupView): void {
  const names = group.skills.map(skill => skill.name)
  openInstallDialog(
    group.origin.source,
    group.origin.ref ?? '',
    names,
    activeScope.value?.scope.kind === 'project' ? 'project' : 'global',
  )
}

async function resolveInstallSource(preselect?: string[]): Promise<void> {
  const input = installSource.value.trim()
  if (!input) {
    installError.value = '请先填写来源'
    return
  }
  installResolving.value = true
  installError.value = ''
  installResult.value = null
  try {
    const catalog = await resolveSkillSource(input, installRef.value.trim() || undefined)
    installCatalog.value = catalog
    const available = new Set(catalog.entries.map(entry => entry.name))
    const names = preselect ?? [...installSelectedNames.value]
    installSelectedNames.value = new Set(names.filter(name => available.has(name)))
  } catch (reason) {
    installCatalog.value = null
    installError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    installResolving.value = false
  }
}

function toggleInstallName(name: string): void {
  const next = new Set(installSelectedNames.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  installSelectedNames.value = next
}

async function installSelected(): Promise<void> {
  const input = installSource.value.trim()
  const names = [...installSelectedNames.value]
  if (!input || names.length === 0) {
    installError.value = '请先解析来源并至少选择一个技能'
    return
  }
  const targetScope = installTarget.value === 'project' ? projectScope.value : undefined
  if (installTarget.value === 'project' && !targetScope?.scope.projectPath) {
    installError.value = '当前没有可用的项目目录'
    return
  }
  installing.value = true
  installError.value = ''
  try {
    const result = await installSkillManagerSkills({
      input,
      ref: installRef.value.trim() || undefined,
      names,
      scopeId: targetScope?.scope.id ?? 'global',
      projectPath: targetScope?.scope.projectPath,
    })
    installResult.value = result
    if (result.status === 'conflict') {
      installError.value = result.conflicts.map(item => item.message).join('；')
      return
    }
    toast.success(`已安装 ${result.installed.length} 个、更新 ${result.updated.length} 个技能${targetScope ? '到项目' : '到全局'}`)
    installOpen.value = false
    await refresh()
  } catch (reason) {
    installError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    installing.value = false
  }
}

function planExecutable(item: PlanItem): boolean {
  return item.action === 'update' || item.action === 'move' || item.action === 'reinstall' || item.action === 'remove'
}

function setPlan(next: UpdatePlan, scopeId: string): void {
  plan.value = next
  planScopeId.value = scopeId
  const syncAdds = settings.value?.defaultUpdatePolicy === 'sync'
  planSelected.value = next.items
    .filter(item => planExecutable(item) && (item.selectedByDefault || (syncAdds && item.action === 'add')))
    .map(item => item.name)
  planResult.value = null
  planUndoResult.value = null
  lastPlanHistoryId.value = ''
}

async function checkUpdates(group: RepoGroupView): Promise<void> {
  if (group.orphan) return
  planOpen.value = true
  plan.value = null
  planError.value = ''
  planResult.value = null
  planUndoResult.value = null
  lastPlanHistoryId.value = ''
  planScopeId.value = activeScope.value?.scope.id ?? ''
  planCheckingGroupKey.value = group.key
  try {
    const next = await checkSkillManagerUpdates({
      scopeId: planScopeId.value,
      groupKey: group.key,
    })
    setPlan(next, planScopeId.value)
  } catch (reason) {
    planError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    planCheckingGroupKey.value = ''
  }
}

function togglePlanItem(name: string): void {
  const next = new Set(planSelected.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  planSelected.value = [...next]
}

async function applyPlan(): Promise<void> {
  const current = plan.value
  if (!current) return
  const names = current.items
    .filter(item => planSelected.value.includes(item.name) && planExecutable(item))
    .map(item => item.name)
  if (!names.length) {
    planError.value = '请至少勾选一个可执行项'
    return
  }
  planApplying.value = true
  planError.value = ''
  try {
    const result = await applySkillManagerPlan({ planId: current.id, names })
    planResult.value = result
    lastPlanHistoryId.value = result.historyId
    planSelected.value = []
    toast.success(`更新 ${result.updated.length} 个、移除 ${result.removed.length} 个${result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ''}`)
    await refresh()
  } catch (reason) {
    planError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    planApplying.value = false
  }
}

async function undoPlan(): Promise<void> {
  if (!lastPlanHistoryId.value) return
  planApplying.value = true
  planError.value = ''
  try {
    const result = await undoSkillManagerPlan({
      scopeId: planScopeId.value,
      historyId: lastPlanHistoryId.value,
    })
    planUndoResult.value = result
    lastPlanHistoryId.value = ''
    toast.success(`已恢复 ${result.restored.length} 个技能`)
    await refresh()
  } catch (reason) {
    planError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    planApplying.value = false
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function toggleEnabled(skill: InstalledSkill): Promise<void> {
  const enabling = skill.state === 'disabled'
  const drift = skill.state === 'disabled-drift'
  if (!enabling) {
    try {
      await confirm(
        drift
          ? `${skill.name} 的活动目录与禁用区副本同时存在。将把活动目录移入回收站，保留禁用区副本。`
          : `将 ${skill.name} 移出扫描根，放入禁用区。全局技能会移除锁条目，项目技能保留锁条目；可随时启用。`,
        drift ? '解决禁用冲突' : '禁用技能',
        { type: 'warning', confirmButtonText: drift ? '处理冲突' : '禁用' },
      )
    } catch {
      return
    }
  }
  const key = `${skill.scopeId}:${skill.name}`
  trashBusyKey.value = key
  try {
    const result = await setSkillManagerEnabled({
      scopeId: skill.scopeId,
      names: [skill.name],
      enabled: enabling,
    })
    toast.success(drift ? `已处理 ${skill.name} 的禁用冲突` : `${enabling ? '已启用' : '已禁用'} ${skill.name}`)
    if (result.warnings.length) toast.info(result.warnings.join('；'))
    await refresh()
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  } finally {
    trashBusyKey.value = ''
  }
}

function removedReasonLabel(reason: RemovedSkillView['removedReason']): string {
  if (reason === 'removed-upstream') return '上游删除'
  if (reason === 'external') return '外部删除'
  return '已卸载'
}

async function loadRemoved(): Promise<void> {
  removedLoading.value = true
  removedError.value = ''
  try {
    removed.value = (await listSkillManagerRemoved()).items
  }
  catch (reason) {
    removedError.value = reason instanceof Error ? reason.message : String(reason)
  }
  finally {
    removedLoading.value = false
  }
}

async function openRemoved(): Promise<void> {
  removedOpen.value = true
  await loadRemoved()
}

function openAdopt(skill: InstalledSkill): void {
  adoptTarget.value = skill
  const group = activeGroups.value.find(item => item.skills.some(candidate => candidate.name === skill.name))
  const knownSource = group && group.origin.sourceType !== 'unknown' ? group.origin.source : ''
  adoptInput.value = knownSource
  adoptRef.value = ''
  adoptPath.value = skill.skillPath ?? ''
  adoptMode.value = knownSource ? 'source' : 'local'
  adoptError.value = ''
  adoptOpen.value = true
}

async function adoptSkill(): Promise<void> {
  const skill = adoptTarget.value
  if (!skill) return
  adoptBusy.value = true
  adoptError.value = ''
  try {
    const result = await adoptSkillManagerSkill({
      scopeId: skill.scopeId,
      name: skill.name,
      mode: adoptMode.value,
      input: adoptMode.value === 'source' ? adoptInput.value.trim() : undefined,
      ref: adoptMode.value === 'source' ? adoptRef.value.trim() || undefined : undefined,
      skillPath: adoptMode.value === 'source' ? adoptPath.value.trim() || undefined : undefined,
    })
    adoptOpen.value = false
    toast.success(result.lockManaged ? `已接管 ${skill.name} 并绑定来源` : `已本地接管 ${skill.name}`)
    if (result.warnings.length) toast.info(result.warnings.join('；'))
    await refresh()
  }
  catch (reason) {
    adoptError.value = reason instanceof Error ? reason.message : String(reason)
  }
  finally {
    adoptBusy.value = false
  }
}

async function deleteOrphan(skill: InstalledSkill): Promise<void> {
  try {
    await confirm(
      `将 ${skill.name} 移入回收站。它没有锁记录，删除后仍可从「已移除」恢复目录或遗忘。`,
      '删除未托管技能',
      { type: 'warning', confirmButtonText: '移入回收站' },
    )
  }
  catch {
    return
  }
  const key = `${skill.scopeId}:${skill.name}`
  removedBusyKey.value = key
  try {
    await deleteSkillManagerSkill(skill.scopeId, skill.name)
    toast.success(`已将 ${skill.name} 移入回收站`)
    await refresh()
  }
  catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  }
  finally {
    removedBusyKey.value = ''
  }
}

async function reinstallRemoved(item: RemovedSkillView): Promise<void> {
  const key = `${item.scopeId}:${item.name}`
  removedBusyKey.value = key
  try {
    await reinstallSkillManagerRemoved(item.scopeId, item.name)
    toast.success(`已重新安装 ${item.name}`)
    removedOpen.value = false
    await refresh()
  }
  catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  }
  finally {
    removedBusyKey.value = ''
  }
}

async function forgetRemoved(item: RemovedSkillView): Promise<void> {
  try {
    await confirm(`只删除 ${item.name} 的墓碑记录，不会动目录或回收站。`, '遗忘已移除技能', {
      type: 'warning',
      confirmButtonText: '遗忘',
    })
  }
  catch {
    return
  }
  const key = `${item.scopeId}:${item.name}`
  removedBusyKey.value = key
  try {
    await forgetSkillManagerRemoved(item.scopeId, item.name)
    toast.success(`已遗忘 ${item.name}`)
    await loadRemoved()
    await refresh()
  }
  catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  }
  finally {
    removedBusyKey.value = ''
  }
}

async function loadTrash(): Promise<void> {
  trashLoading.value = true
  trashError.value = ''
  try {
    const [nextTrash, nextSettings] = await Promise.all([
      listSkillManagerTrash(),
      getSkillManagerSettings().catch(() => null),
    ])
    trash.value = nextTrash
    if (nextSettings) settings.value = nextSettings
  } catch (reason) {
    trashError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    trashLoading.value = false
  }
}

async function saveAutoReDisable(value: boolean): Promise<void> {
  settingsBusy.value = true
  try {
    settings.value = await updateSkillManagerSettings({ autoReDisable: value })
    toast.success(value ? '已开启扫描时自动重新禁用' : '已关闭自动重新禁用')
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  } finally {
    settingsBusy.value = false
  }
}

function openTrash(): void {
  trashOpen.value = true
  void loadTrash()
}

async function restoreTrash(item: TrashItemView): Promise<void> {
  const key = `${item.operationId}:${item.name}`
  trashBusyKey.value = key
  try {
    const result = await restoreSkillManagerTrash(item.operationId, item.name)
    toast.success(`已恢复 ${item.name}`)
    if (result.warnings.length) toast.info(result.warnings.join('；'))
    await loadTrash()
    await refresh()
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  } finally {
    trashBusyKey.value = ''
  }
}

async function deleteTrash(item: TrashItemView): Promise<void> {
  try {
    await confirm(`永久删除 ${item.name}？此操作不可撤销。`, '删除回收站条目', { type: 'warning', confirmButtonText: '永久删除' })
  } catch {
    return
  }
  const key = `${item.operationId}:${item.name}`
  trashBusyKey.value = key
  try {
    await deleteSkillManagerTrash(item.operationId, item.name)
    toast.success(`已删除 ${item.name}`)
    await loadTrash()
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  } finally {
    trashBusyKey.value = ''
  }
}

async function clearTrash(): Promise<void> {
  if (!trash.value?.items.length) return
  try {
    await confirm('清空回收站？所有条目将被永久删除。', '清空回收站', { type: 'warning', confirmButtonText: '清空' })
  } catch {
    return
  }
  try {
    const result = await clearSkillManagerTrash()
    toast.success(`已清空 ${result.removed} 项，释放 ${formatBytes(result.freedBytes)}`)
    await loadTrash()
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  }
}

function switchTab(key: string): void {
  if (key === activeTab.value) return
  const tab = SKILL_MANAGER_TABS.find(item => item.key === key)
  if (tab) void router.push({ name: tab.routeName })
}

function setScope(id: string): void {
  activeScopeId.value = id
}

function matchesFilter(skill: InstalledSkill): boolean {
  if (statusFilter.value === 'update') return skill.state === 'update-available'
  if (statusFilter.value === 'removed') return skill.state === 'removed-upstream'
  if (statusFilter.value === 'orphan') return skill.state === 'orphan'
  if (statusFilter.value === 'disabled') return skill.state === 'disabled' || skill.state === 'disabled-drift'
  return true
}

function matchesQuery(skill: InstalledSkill): boolean {
  const query = search.value.trim().toLowerCase()
  if (!query) return true
  return [
    skill.name,
    skill.description ?? '',
    skill.category ?? '',
    skill.skillPath ?? '',
    skill.origin.source,
  ].some(value => value.toLowerCase().includes(query))
}

function groupSkills(group: RepoGroupView): InstalledSkill[] {
  return group.skills.filter(skill => matchesFilter(skill) && matchesQuery(skill))
}

function toggleGroup(key: string): void {
  collapsed.value[key] = !collapsed.value[key]
}

function isFavorite(skill: InstalledSkill): boolean {
  return favoriteMap.value.has(skillOriginKey(skill.origin))
}

async function toggleFavorite(skill: InstalledSkill): Promise<void> {
  const key = skillOriginKey(skill.origin)
  const favorite = !favoriteMap.value.has(key)
  try {
    favoritesView.value = await toggleSkillManagerFavorite({
      origin: skill.origin,
      name: skill.name,
      favorite,
      categories: favorite ? ['engineering'] : undefined,
      snapshot: {
        description: skill.description,
        category: skill.category,
        scopeId: skill.scopeId,
        state: skill.state,
      },
    })
    toast.success(favorite ? `已收藏 ${skill.name}` : `已取消收藏 ${skill.name}`)
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  }
}

function groupPending(group: RepoGroupView): number {
  return group.counts.update + group.counts.modified + group.counts.invalid + group.counts.missing + group.counts.removed
}

function lockLabel(scope: ScopeInventory): string {
  if (scope.scope.lockState === 'ok') {
    return scope.scope.lockVersion ? `锁 v${scope.scope.lockVersion}` : '锁已就绪'
  }
  if (scope.scope.lockState === 'unsupported') return '锁版本不支持'
  if (scope.scope.lockState === 'invalid') return '锁读取失败'
  return '未建锁'
}

function scopeLabel(scope: ScopeInventory): string {
  return scope.scope.kind === 'global' ? '全局' : scope.scope.label
}

function pathLabel(skill: InstalledSkill): string {
  const path = skill.skillPath || `${skill.dirName}/SKILL.md`
  return skill.installMode === 'symlink' ? `${path} → ${skill.linkTarget ?? '外部目录'}` : path
}

function comingSoon(action: string): void {
  toast.info(`${action}将在后续步骤接入`)
}

async function loadCollections(): Promise<void> {
  const [favorites, presets, nextSettings] = await Promise.all([
    getSkillManagerFavorites().catch(() => null),
    getSkillManagerPresets().catch(() => null),
    getSkillManagerSettings().catch(() => null),
  ])
  if (favorites) favoritesView.value = favorites
  if (presets) presetsFile.value = presets
  if (nextSettings) settings.value = nextSettings
}

async function openSettings(): Promise<void> {
  settingsOpen.value = true
  projectError.value = ''
  await loadSettingsPanel()
}

async function loadSettingsPanel(): Promise<void> {
  const [nextProjects, nextTokens, nextSettings] = await Promise.all([
    listSkillManagerProjects().catch(() => []),
    listSkillManagerTokens().catch(() => null),
    getSkillManagerSettings().catch(() => null),
  ])
  projects.value = nextProjects
  if (nextTokens) tokenState.value = nextTokens
  if (nextSettings) settings.value = nextSettings
}

async function patchSettings(patch: Partial<SkillManagerSettings>): Promise<void> {
  settingsBusy.value = true
  try {
    settings.value = await updateSkillManagerSettings(patch)
    toast.success('设置已保存')
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  } finally {
    settingsBusy.value = false
  }
}

async function addProject(): Promise<void> {
  if (!projectPathInput.value.trim()) return
  projectBusy.value = true
  projectError.value = ''
  try {
    await addSkillManagerProject(projectPathInput.value.trim())
    projectPathInput.value = ''
    await loadSettingsPanel()
    await refresh()
    toast.success('项目已登记')
  } catch (reason) {
    projectError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    projectBusy.value = false
  }
}

async function rescanProject(project: ProjectRecord): Promise<void> {
  projectBusy.value = true
  projectError.value = ''
  try {
    const next = await rescanSkillManagerProject(project.id)
    projects.value = projects.value.map(item => item.id === next.id ? next : item)
    await refresh()
    toast.success(`已重扫 ${next.name}`)
  } catch (reason) {
    projectError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    projectBusy.value = false
  }
}

async function removeProject(project: ProjectRecord): Promise<void> {
  try {
    await confirm(`从登记表移除 ${project.name}，不会删除项目文件或技能目录。`, '移除项目', {
      type: 'warning',
      confirmButtonText: '移除',
    })
  } catch {
    return
  }
  projectBusy.value = true
  try {
    await removeSkillManagerProject(project.id)
    await loadSettingsPanel()
    await refresh()
    toast.success('项目已移除')
  } catch (reason) {
    projectError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    projectBusy.value = false
  }
}

async function saveToken(): Promise<void> {
  if (!tokenHost.value.trim() || !tokenValue.value.trim()) return
  tokenBusy.value = true
  try {
    tokenState.value = await saveSkillManagerToken(tokenHost.value.trim(), tokenValue.value.trim())
    tokenHost.value = ''
    tokenValue.value = ''
    toast.success('令牌已加密保存')
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  } finally {
    tokenBusy.value = false
  }
}

async function removeToken(host: string): Promise<void> {
  try {
    await confirm(`删除 ${host} 的令牌；后续访问私有仓库时会重新要求凭据。`, '删除令牌', {
      type: 'warning',
      confirmButtonText: '删除',
    })
  } catch {
    return
  }
  tokenBusy.value = true
  try {
    tokenState.value = await deleteSkillManagerToken(host)
    toast.success('令牌已删除')
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  } finally {
    tokenBusy.value = false
  }
}

async function runAutoCheck(): Promise<void> {
  const interval = settings.value?.autoCheckIntervalHours ?? 0
  if (interval <= 0) return
  const key = 'skill-manager:last-auto-check'
  const last = Number(localStorage.getItem(key) ?? 0)
  if (Number.isFinite(last) && Date.now() - last < interval * 3_600_000) return
  localStorage.setItem(key, String(Date.now()))
  autoChecking.value = true
  let pending = 0
  for (const scope of inventory.value?.scopes ?? []) {
    for (const group of scope.groups) {
      if (group.orphan) continue
      try {
        const plan = await checkSkillManagerUpdates({ scopeId: scope.scope.id, groupKey: group.key })
        pending += plan.items.filter(item => planExecutable(item) && item.selectedByDefault).length
      } catch {
        // 单个仓库失败不阻断其它仓库，也不把失败当作删除。
      }
    }
  }
  autoChecking.value = false
  if (pending > 0) toast.info(`自动检查发现 ${pending} 项待处理，可在仓库行打开计划。`)
}

function categoryIcon(icon?: string): IconName {
  return (icon || 'star') as IconName
}

function favoriteCount(categoryId: string): number {
  return (favoritesView.value?.items ?? []).filter(item => item.categories.includes(categoryId)).length
}

function openPresetCreate(): void {
  const seen = new Set<string>()
  presetDraftItems.value = activeSkills.value
    .filter(skill => !skill.forked && (skill.tracked || skill.state === 'disabled'))
    .filter((skill) => {
      const key = skillOriginKey(skill.origin)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(skill => ({
      key: skillOriginKey(skill.origin),
      name: skill.name,
      origin: skill.origin,
      installName: skill.name,
      enabled: !skill.disabled,
    }))
  presetName.value = `${activeScope.value?.scope.label ?? '技能'} 预设`
  presetDescription.value = ''
  presetCreateMode.value = 'additive'
  presetCreateOpen.value = true
}

async function savePreset(): Promise<void> {
  if (!presetName.value.trim()) {
    toast.error('请填写预设名称')
    return
  }
  if (presetDraftItems.value.length === 0) {
    toast.error('当前范围没有可作为预设的技能')
    return
  }
  presetSaving.value = true
  try {
    const next = await saveSkillManagerPreset({
      name: presetName.value,
      description: presetDescription.value,
      createdFrom: `scope:${activeScope.value?.scope.id ?? 'unknown'}`,
      defaultTarget: activeScope.value?.scope.kind === 'project'
        ? { kind: 'project', scopeId: activeScope.value.scope.id }
        : { kind: 'global' },
      applyMode: presetCreateMode.value,
      items: presetDraftItems.value,
    })
    presetsFile.value = next
    presetCreateOpen.value = false
    toast.success(`已保存预设「${presetName.value}」`)
    switchTab('presets')
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  } finally {
    presetSaving.value = false
  }
}

async function removePreset(preset: Preset): Promise<void> {
  try {
    await confirm(`删除预设「${preset.name}」？只删除期望清单，不影响已安装技能。`, '删除预设', {
      type: 'warning',
      confirmButtonText: '删除',
    })
  } catch {
    return
  }
  try {
    presetsFile.value = await deleteSkillManagerPreset(preset.id)
    toast.success('预设已删除')
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  }
}

function openPresetApply(preset: Preset): void {
  presetApplyId.value = preset.id
  presetApplyTarget.value = preset.defaultTarget?.kind ?? (projectScope.value ? 'project' : 'global')
  presetApplyPath.value = preset.defaultTarget?.path ?? projectScope.value?.scope.projectPath ?? ''
  presetApplyMode.value = preset.applyMode ?? 'additive'
  presetApplyExactAck.value = false
  presetApplyRegister.value = presetApplyTarget.value !== 'global'
  presetApplyError.value = ''
  presetApplyResult.value = null
  presetApplyOpen.value = true
}

async function applyPreset(): Promise<void> {
  if (!presetApplyId.value) return
  if (presetApplyMode.value === 'exact' && !presetApplyExactAck.value) {
    presetApplyError.value = 'exact 模式会移除目标里预设外的技能，请先确认。'
    return
  }
  if (presetApplyTarget.value !== 'global' && !presetApplyPath.value.trim()) {
    presetApplyError.value = '请填写目标项目或目录'
    return
  }
  presetApplying.value = true
  presetApplyError.value = ''
  try {
    const target = presetApplyTarget.value === 'global'
      ? { kind: 'global' as const }
      : { kind: presetApplyTarget.value, path: presetApplyPath.value.trim() }
    presetApplyResult.value = await applySkillManagerPreset({
      presetId: presetApplyId.value,
      target,
      mode: presetApplyMode.value,
      registerProject: presetApplyTarget.value !== 'global' && presetApplyRegister.value,
    })
    const result = presetApplyResult.value
    toast.success(`预设已应用：安装 ${result.installed.length}、更新 ${result.updated.length}、移除 ${result.removed.length}`)
    await Promise.all([refresh(), loadCollections()])
  } catch (reason) {
    presetApplyError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    presetApplying.value = false
  }
}

async function exportPresets(): Promise<void> {
  try {
    const result = await exportSkillManagerPresets()
    await navigator.clipboard.writeText(result.raw)
    toast.success(`已复制 ${result.count} 个预设的 JSON`)
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : String(reason))
  }
}

async function importPresets(): Promise<void> {
  presetImportError.value = ''
  try {
    presetsFile.value = await importSkillManagerPresets(presetImportText.value)
    presetImportOpen.value = false
    presetImportText.value = ''
    toast.success('预设已导入')
  } catch (reason) {
    presetImportError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const next = await scanSkillManager()
    inventory.value = next
    removed.value = next.scopes.flatMap(scope => scope.removed).sort((a, b) => b.removedAt.localeCompare(a.removedAt))
    if (!next.scopes.some(scope => scope.scope.id === activeScopeId.value)) {
      activeScopeId.value = next.scopes[0]?.scope.id ?? ''
    }
  } catch (reason) {
    inventory.value = null
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
  await loadCollections()
}

onMounted(async () => {
  await refresh()
  await runAutoCheck()
})

watch(activeTab, (tab) => {
  if (tab === 'projects') void loadSettingsPanel()
}, { immediate: true })
</script>

<template>
  <div class="skill-manager-page tool-page">
    <Teleport v-if="paneActive" defer to="#app-topbar-state">
      <span class="tb-state" :class="`is-${statusTone}`">
        <i class="tb-dot" />
        {{ statusLabel }}
      </span>
    </Teleport>

    <Teleport v-if="paneActive" defer to="#app-topbar-actions">
      <UiButton class="check-all-button" size="small" @click="refresh">
        重新扫描
      </UiButton>
      <UiButton size="small" type="primary" @click="openInstallDialog()">
        安装技能
      </UiButton>
      <UiButton size="small" @click="openSettings">
        设置
      </UiButton>
      <UiButton size="small" @click="openTrash">
        回收站
      </UiButton>
    </Teleport>

    <ToolSurface class="skill-surface">
      <template #spine>
        <WorkspaceSpine
          :model-value="activeTab"
          :items="menuItems"
          @update:model-value="switchTab"
        />
      </template>

      <template #toolbar>
        <div class="surface-toolbar-content">
          <UiSearchInput
            v-model="search"
            variant="box"
            width="260px"
            placeholder="搜索技能、仓库或路径"
            clearable
          />
          <div class="filter-group" role="group" aria-label="状态筛选">
            <button
              type="button"
              class="filter-chip"
              :class="{ 'is-active': statusFilter === 'all' }"
              @click="statusFilter = 'all'"
            >
              全部 <span>{{ filterCounts.all }}</span>
            </button>
            <button
              type="button"
              class="filter-chip"
              :class="{ 'is-active': statusFilter === 'update' }"
              @click="statusFilter = 'update'"
            >
              待更新 <span>{{ filterCounts.update }}</span>
            </button>
            <button
              type="button"
              class="filter-chip"
              :class="{ 'is-active': statusFilter === 'removed' }"
              @click="statusFilter = 'removed'"
            >
              失效 <span>{{ filterCounts.removed }}</span>
            </button>
            <button
              type="button"
              class="filter-chip"
              :class="{ 'is-active': statusFilter === 'orphan' }"
              @click="statusFilter = 'orphan'"
            >
              未托管 <span>{{ filterCounts.orphan }}</span>
            </button>
            <button
              type="button"
              class="filter-chip"
              :class="{ 'is-active': statusFilter === 'disabled' }"
              @click="statusFilter = 'disabled'"
            >
              已禁用 <span>{{ filterCounts.disabled }}</span>
            </button>
          </div>
          <span class="toolbar-spacer" />
          <span class="toolbar-meta" :title="scannedLabel">
            {{ activeScope ? `${activeScope.summary.onDisk} 目录 · ${activeScope.summary.tracked} 托管` : '未读取' }}
          </span>
          <span class="toolbar-note">按仓库分组</span>
          <UiIconButton icon="layers" label="切换分组" :size="28" @click="comingSoon('切换分组')" />
          <UiIconButton icon="refresh" label="刷新" :size="28" @click="refresh" />
        </div>
      </template>

      <div class="surface-body">
        <aside v-if="activeTab === 'installed'" class="scope-pane" aria-label="范围与状态">
          <div class="pane-label">
            范围
          </div>
          <button
            v-for="scope in scopes"
            :key="scope.scope.id"
            type="button"
            class="scope-row"
            :class="{ 'is-active': activeScope?.scope.id === scope.scope.id }"
            @click="setScope(scope.scope.id)"
          >
            <UiIcon :name="scope.scope.kind === 'global' ? 'layers' : 'home'" :size="15" />
            {{ scopeLabel(scope) }}
            <span class="scope-lock">{{ lockLabel(scope) }}</span>
            <span class="scope-num">{{ scope.summary.total }}</span>
          </button>
          <div class="scope-sub">
            <button type="button" class="is-active">
              <span class="scope-dot" />{{ activeScope?.scope.kind === 'global' ? '全局技能' : '项目技能' }}
              <span class="scope-num">{{ activeSummary?.total ?? 0 }}</span>
            </button>
            <button type="button" @click="comingSoon('添加项目')">
              + 添加项目
            </button>
          </div>

          <div class="pane-rule" />
          <div class="pane-label">
            状态
          </div>
          <button type="button" class="filter-row" :class="{ 'is-active': statusFilter === 'all' }" @click="statusFilter = 'all'">
            <span class="filter-dot" />全部 <span class="scope-num">{{ filterCounts.all }}</span>
          </button>
          <button type="button" class="filter-row" :class="{ 'is-active': statusFilter === 'update' }" @click="statusFilter = 'update'">
            <span class="filter-dot is-warning" />待更新 <span class="scope-num">{{ filterCounts.update }}</span>
          </button>
          <button type="button" class="filter-row" :class="{ 'is-active': statusFilter === 'removed' }" @click="statusFilter = 'removed'">
            <span class="filter-dot is-danger" />已失效 <span class="scope-num">{{ filterCounts.removed }}</span>
          </button>
          <button type="button" class="filter-row" :class="{ 'is-active': statusFilter === 'orphan' }" @click="statusFilter = 'orphan'">
            <span class="filter-dot" />未托管 <span class="scope-num">{{ filterCounts.orphan }}</span>
          </button>
          <button type="button" class="filter-row" :class="{ 'is-active': statusFilter === 'disabled' }" @click="statusFilter = 'disabled'">
            <span class="filter-dot" />已禁用 <span class="scope-num">{{ filterCounts.disabled }}</span>
          </button>
          <button type="button" class="filter-row" @click="openRemoved">
            <span class="filter-dot is-danger" />已移除 <span class="scope-num">{{ activeRemoved.length }}</span>
          </button>

          <div class="pane-hint">
            只读扫描：未托管不等于损坏，默认不写锁、不移动文件。
          </div>
        </aside>

        <div class="view-stack">
          <div v-if="loading" class="placeholder-view">
            <div class="placeholder-icon">
              <UiIcon name="refresh" :size="23" />
            </div>
            <h2>正在扫描本机技能</h2>
            <p>读取全局与当前项目目录，不会改动任何文件。</p>
          </div>

          <div v-else-if="error" class="placeholder-view">
            <div class="placeholder-icon">
              <UiIcon name="info" :size="23" />
            </div>
            <h2>扫描未完成</h2>
            <p>{{ error }}</p>
            <UiButton size="small" @click="refresh">
              重试
            </UiButton>
          </div>

          <div v-else-if="activeTab === 'installed'" class="table-scroll">
            <table v-if="visibleGroups.length" class="skill-table">
              <colgroup>
                <col class="col-skill">
                <col class="col-state">
                <col class="col-source">
                <col class="col-action">
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">
                    仓库 / 技能
                  </th>
                  <th scope="col">
                    状态
                  </th>
                  <th scope="col">
                    来源路径
                  </th>
                  <th scope="col">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                <template v-for="group in visibleGroups" :key="group.key">
                  <tr class="group-row">
                    <td colspan="4">
                      <div class="group-line">
                        <button
                          type="button"
                          class="group-toggle"
                          :aria-label="`${collapsed[group.key] ? '展开' : '折叠'} ${group.displayName}`"
                          :aria-expanded="!collapsed[group.key]"
                          @click="toggleGroup(group.key)"
                        >
                          <UiIcon name="chevronDown" :size="13" :class="{ 'is-collapsed': collapsed[group.key] }" />
                        </button>
                        <span class="group-icon" aria-hidden="true">
                          <UiIcon :name="group.orphan ? 'info' : 'layers'" :size="13" />
                        </span>
                        <span class="group-name">{{ group.displayName }}</span>
                        <span class="group-host">{{ group.host }}</span>
                        <UiChip tone="primary">
                          {{ group.counts.selected }}/{{ group.counts.remoteTotal }} 已选
                        </UiChip>
                        <span v-if="groupPending(group)" class="group-state is-warning">
                          <UiStatusTag tone="warning" />{{ groupPending(group) }} 待处理
                        </span>
                        <span v-else class="group-state">
                          <UiStatusTag tone="success" />最新
                        </span>
                        <div v-if="!group.orphan" class="group-actions">
                          <UiButton
                            size="small"
                            :loading="planCheckingGroupKey === group.key"
                            @click="checkUpdates(group)"
                          >
                            {{ planCheckingGroupKey === group.key ? '检查中…' : '检查更新' }}
                          </UiButton>
                          <UiButton size="small" text @click="openGroupInstall(group)">
                            管理技能
                          </UiButton>
                        </div>
                      </div>
                    </td>
                  </tr>
                  <tr
                    v-for="skill in groupSkills(group)"
                    v-show="!collapsed[group.key]"
                    :key="skill.key"
                    class="skill-row"
                  >
                    <td class="cell-skill">
                      <div class="skill-main">
                        <span class="indent" />
                        <UiStatusTag :tone="STATE_META[skill.state].tone" />
                        <span class="skill-name">{{ skill.name }}</span>
                        <UiChip>{{ skill.category || '未分类' }}</UiChip>
                        <UiChip v-if="skill.installMode === 'symlink'" tone="neutral">
                          链接
                        </UiChip>
                        <UiChip v-if="skill.lockManaged === false" tone="neutral">
                          本地
                        </UiChip>
                      </div>
                      <div class="skill-desc">
                        {{ skill.description || '暂无描述' }}
                      </div>
                    </td>
                    <td>
                      <span class="state-text" :class="`is-${STATE_META[skill.state].tone}`">
                        {{ STATE_META[skill.state].label }}
                      </span>
                    </td>
                    <td><span class="path" :title="pathLabel(skill)">{{ pathLabel(skill) }}</span></td>
                    <td>
                      <div class="row-actions">
                        <button
                          type="button"
                          class="star-button"
                          :class="{ 'is-on': isFavorite(skill) }"
                          :aria-pressed="isFavorite(skill)"
                          :aria-label="`${isFavorite(skill) ? '取消收藏' : '收藏'} ${skill.name}`"
                          @click="toggleFavorite(skill)"
                        >
                          <UiIcon name="star" :size="15" />
                        </button>
                        <UiIconButton
                          v-if="(skill.tracked && skill.lockManaged !== false) || skill.state === 'disabled' || skill.state === 'disabled-drift'"
                          :icon="skill.state === 'disabled' ? 'play' : 'pause'"
                          :label="`${skill.state === 'disabled' ? '启用' : skill.state === 'disabled-drift' ? '解决冲突' : '禁用'} ${skill.name}`"
                          :size="26"
                          :disabled="trashBusyKey === `${skill.scopeId}:${skill.name}`"
                          @click="toggleEnabled(skill)"
                        />
                        <template v-if="skill.state === 'orphan' || skill.state === 'linked'">
                          <UiIconButton
                            icon="plus"
                            :label="`接管 ${skill.name}`"
                            :size="26"
                            :disabled="removedBusyKey === `${skill.scopeId}:${skill.name}`"
                            @click="openAdopt(skill)"
                          />
                          <UiIconButton
                            icon="trash"
                            :label="`删除 ${skill.name}`"
                            :size="26"
                            :disabled="removedBusyKey === `${skill.scopeId}:${skill.name}`"
                            @click="deleteOrphan(skill)"
                          />
                        </template>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
            <UiEmpty
              v-else
              center
              icon="search"
              title="没有匹配的技能"
              text="换一个筛选条件或清空搜索词。"
              padding="var(--spacing-2xl)"
            />
          </div>

          <div v-else-if="activeTab === 'updates'" class="updates-view">
            <div v-if="!plan" class="placeholder-view">
              <div class="placeholder-icon">
                <UiIcon name="refresh" :size="23" />
              </div>
              <h2>还没有更新计划</h2>
              <p>在技能库里选一个仓库点「检查更新」，计划会显示在这里。</p>
              <UiButton size="small" @click="switchTab('installed')">
                去技能库
              </UiButton>
            </div>
            <div v-else class="updates-plan">
              <div class="updates-head">
                <div>
                  <h2>{{ planTitle }}</h2>
                  <p>远端快照与锁内成员对比；只有勾选项会写入锁与目录。</p>
                </div>
                <UiChip>{{ planSelectedCount }} 项待执行</UiChip>
              </div>

              <p v-if="planError" class="plan-error">
                {{ planError }}
              </p>
              <div v-if="planResult" class="plan-result">
                已更新 {{ planResult.updated.length }} 个、移除 {{ planResult.removed.length }} 个{{ planResult.skipped.length ? `，跳过 ${planResult.skipped.length} 个` : '' }}。
                <span v-if="lastPlanHistoryId">可撤销本次操作。</span>
              </div>
              <div v-if="planUndoResult" class="plan-result is-undo">
                已恢复 {{ planUndoResult.restored.length }} 个技能与对应锁记录。
              </div>

              <UpdatePlanPanel
                :plan="plan"
                :selected="planSelected"
                :disabled="planApplying"
                @toggle="togglePlanItem"
              />

              <div class="updates-footer">
                <span class="updates-count">{{ planSelectedCount }} 项选中</span>
                <UiButton v-if="planCanUndo" size="small" :loading="planApplying" @click="undoPlan">
                  撤销本次
                </UiButton>
                <UiButton size="small" type="primary" :loading="planApplying" :disabled="!planCanApply" @click="applyPlan">
                  应用选中
                </UiButton>
              </div>
            </div>
          </div>

          <div v-else-if="activeTab === 'favorites'" class="collection-view">
            <aside class="collection-side">
              <div class="collection-side-head">
                <span>收藏分类</span>
                <UiChip>{{ favoritesView?.items.length ?? 0 }}</UiChip>
              </div>
              <button type="button" class="collection-filter" :class="{ 'is-active': favoriteFilter === 'all' }" @click="favoriteFilter = 'all'">
                全部收藏 <span>{{ favoritesView?.items.length ?? 0 }}</span>
              </button>
              <button
                v-for="category in favoriteCategories"
                :key="category.id"
                type="button"
                class="collection-filter"
                :class="{ 'is-active': favoriteFilter === category.id }"
                @click="favoriteFilter = category.id"
              >
                <UiIcon :name="categoryIcon(category.icon)" :size="14" />
                {{ category.name }} <span>{{ favoriteCount(category.id) }}</span>
              </button>
              <p class="collection-hint">
                收藏是跨 scope 的个人书签；未安装的技能也会留在这里。
              </p>
            </aside>
            <div class="collection-main">
              <div class="collection-head">
                <div>
                  <h2>收藏</h2>
                  <p>按功能分类保存想用的技能；不改动安装目录与锁。</p>
                </div>
                <UiChip>{{ favoriteItems.length }} 项</UiChip>
              </div>
              <div v-if="favoriteItems.length" class="favorite-grid">
                <article v-for="item in favoriteItems" :key="item.key" class="favorite-card">
                  <div class="favorite-card-head">
                    <span class="favorite-star"><UiIcon name="star" :size="15" /></span>
                    <strong>{{ item.displayName || item.name }}</strong>
                    <UiChip :tone="item.installed ? 'success' : 'neutral'">
                      {{ item.installed ? '已安装' : '未安装' }}
                    </UiChip>
                  </div>
                  <p>{{ item.snapshot?.description || item.note || '暂无描述' }}</p>
                  <div class="favorite-card-meta">
                    <span class="mono">{{ item.origin.source }}</span>
                    <span v-if="item.origin.skillPath" class="mono">{{ item.origin.skillPath }}</span>
                  </div>
                  <div class="favorite-card-foot">
                    <UiChip v-for="category in item.categories" :key="category" tone="neutral">
                      {{ favoriteCategories.find(entry => entry.id === category)?.name || category }}
                    </UiChip>
                    <span v-if="item.scopeIds.length" class="favorite-scopes">{{ item.scopeIds.join(' · ') }}</span>
                  </div>
                </article>
              </div>
              <UiEmpty
                v-else
                center
                icon="star"
                title="还没有收藏"
                text="在技能库点星标，收藏会保存到这里；也可以按分类整理。"
                padding="var(--spacing-2xl)"
              />
            </div>
          </div>

          <div v-else-if="activeTab === 'presets'" class="preset-view">
            <div class="collection-head">
              <div>
                <h2>技能预设</h2>
                <p>只保存来源清单；应用到全局、项目或指定目录，默认增量安装。</p>
              </div>
              <div class="preset-head-actions">
                <UiButton size="small" @click="presetImportOpen = true; presetImportError = ''">
                  导入
                </UiButton>
                <UiButton size="small" @click="exportPresets">
                  导出
                </UiButton>
                <UiButton size="small" type="primary" @click="openPresetCreate">
                  从当前范围新建
                </UiButton>
              </div>
            </div>
            <div v-if="presetList.length" class="preset-grid">
              <article v-for="preset in presetList" :key="preset.id" class="preset-card">
                <div class="preset-card-head">
                  <span class="preset-icon"><UiIcon name="layers" :size="16" /></span>
                  <div>
                    <strong>{{ preset.name }}</strong>
                    <p>{{ preset.description || '未填写描述' }}</p>
                  </div>
                  <UiChip tone="neutral">
                    {{ preset.applyMode === 'exact' ? '精确' : '增量' }}
                  </UiChip>
                </div>
                <div class="preset-card-meta">
                  <span>{{ preset.items.length }} 个技能</span>
                  <span>更新于 {{ new Date(preset.updatedAt).toLocaleDateString('zh-CN') }}</span>
                  <span v-if="preset.lastAppliedAt">最近应用 {{ new Date(preset.lastAppliedAt).toLocaleDateString('zh-CN') }}</span>
                </div>
                <div class="preset-card-items">
                  <UiChip v-for="item in preset.items.slice(0, 4)" :key="item.key" tone="neutral">
                    {{ item.installName }}
                  </UiChip>
                  <span v-if="preset.items.length > 4" class="preset-more">+{{ preset.items.length - 4 }}</span>
                </div>
                <div class="preset-card-foot">
                  <UiButton size="small" type="primary" @click="openPresetApply(preset)">
                    应用预设
                  </UiButton>
                  <UiButton size="small" text @click="removePreset(preset)">
                    删除
                  </UiButton>
                </div>
              </article>
            </div>
            <UiEmpty
              v-else
              center
              icon="layers"
              title="还没有预设"
              text="把当前 scope 的已托管技能保存成预设，之后可随时装到另一个项目。"
              padding="var(--spacing-2xl)"
            />
          </div>

          <div v-else-if="activeTab === 'projects'" class="projects-view">
            <div class="projects-head">
              <div>
                <h2>项目</h2>
                <p>登记项目根目录后，会扫描它的 .agents/skills 与 skills-lock.json；登记不会写项目文件。</p>
              </div>
              <UiButton size="small" :loading="projectBusy" @click="openSettings">
                认证与设置
              </UiButton>
            </div>
            <form class="projects-add" @submit.prevent="addProject">
              <UiInput v-model="projectPathInput" placeholder="项目根目录绝对路径，例如 /Users/me/work/app" />
              <UiButton size="small" type="primary" :loading="projectBusy" :disabled="!projectPathInput.trim()" @click="addProject">
                登记项目
              </UiButton>
            </form>
            <p v-if="projectError" class="settings-error">
              {{ projectError }}
            </p>
            <div v-if="projects.length" class="projects-grid">
              <article v-for="project in projects" :key="project.id" class="project-card">
                <div class="project-card-head">
                  <span class="project-icon"><UiIcon name="home" :size="16" /></span>
                  <div>
                    <strong>{{ project.name }}</strong>
                    <span>{{ project.path }}</span>
                  </div>
                </div>
                <div class="project-card-meta">
                  <span>登记 {{ new Date(project.addedAt).toLocaleDateString('zh-CN') }}</span>
                  <span v-if="project.lastScanAt">重扫 {{ new Date(project.lastScanAt).toLocaleString('zh-CN') }}</span>
                  <span v-else>尚未重扫</span>
                </div>
                <div class="project-card-foot">
                  <UiButton size="small" text :disabled="projectBusy" @click="rescanProject(project)">
                    重扫
                  </UiButton>
                  <UiButton size="small" text :disabled="projectBusy" @click="removeProject(project)">
                    移除
                  </UiButton>
                </div>
              </article>
            </div>
            <UiEmpty
              v-else
              center
              icon="home"
              title="还没有登记项目"
              description="登记后可以在安装对话框选择「当前项目」，并在左侧范围列表切换。"
              padding="var(--spacing-2xl)"
            />
          </div>

          <div v-else class="placeholder-view">
            <div class="placeholder-icon">
              <UiIcon name="home" :size="23" />
            </div>
            <h2>{{ SKILL_MANAGER_TABS.find(tab => tab.key === activeTab)?.label }}</h2>
            <p>项目管理将在后续步骤接入。</p>
            <UiButton size="small" @click="switchTab('installed')">
              返回技能库
            </UiButton>
          </div>
        </div>
      </div>
    </ToolSurface>

    <UiDialog v-model="settingsOpen" title="项目与认证" width="760px">
      <div class="settings-dialog">
        <section class="settings-section">
          <div class="settings-heading">
            <h3>项目</h3>
            <span>登记后会参与扫描和安装目标选择</span>
          </div>
          <form class="settings-add" @submit.prevent="addProject">
            <UiInput v-model="projectPathInput" placeholder="项目根目录绝对路径，例如 /Users/me/work/app" />
            <UiButton size="small" type="primary" :loading="projectBusy" :disabled="!projectPathInput.trim()" @click="addProject">
              登记项目
            </UiButton>
          </form>
          <p v-if="projectError" class="settings-error">
            {{ projectError }}
          </p>
          <div v-if="projects.length" class="settings-list">
            <div v-for="project in projects" :key="project.id" class="settings-row">
              <div class="settings-main">
                <strong>{{ project.name }}</strong>
                <span class="settings-path">{{ project.path }}</span>
                <span class="settings-meta">登记于 {{ new Date(project.addedAt).toLocaleDateString() }}{{ project.lastScanAt ? ` · 上次重扫 ${new Date(project.lastScanAt).toLocaleString()}` : '' }}</span>
              </div>
              <div class="settings-actions">
                <UiButton size="small" text :disabled="projectBusy" @click="rescanProject(project)">
                  重扫
                </UiButton>
                <UiButton size="small" text :disabled="projectBusy" @click="removeProject(project)">
                  移除
                </UiButton>
              </div>
            </div>
          </div>
          <UiEmpty v-else center icon="home" title="还没有登记项目" description="登记后即可在安装对话框选择「当前项目」，并扫描它的 .agents/skills。" />
        </section>

        <section v-if="settings" class="settings-section">
          <div class="settings-heading">
            <h3>更新与网络</h3>
            <span>自动检查只读远端，不会自动改锁或文件</span>
          </div>
          <div class="settings-grid">
            <label class="settings-field">
              <span>更新策略</span>
              <select :value="settings.defaultUpdatePolicy" :disabled="settingsBusy" @change="patchSettings({ defaultUpdatePolicy: ($event.target as HTMLSelectElement).value === 'sync' ? 'sync' : 'safe' })">
                <option value="safe">安全：只更新已选技能</option>
                <option value="sync">同步：同时勾选新增技能</option>
              </select>
            </label>
            <label class="settings-field">
              <span>自动检查间隔（小时，0 关闭）</span>
              <input type="number" min="0" max="168" :value="settings.autoCheckIntervalHours" :disabled="settingsBusy" @change="patchSettings({ autoCheckIntervalHours: Number(($event.target as HTMLInputElement).value) })">
            </label>
            <label class="settings-field">
              <span>网络超时（毫秒）</span>
              <input type="number" min="3000" max="120000" step="1000" :value="settings.networkTimeoutMs" :disabled="settingsBusy" @change="patchSettings({ networkTimeoutMs: Number(($event.target as HTMLInputElement).value) })">
            </label>
            <label class="settings-field">
              <span>删除策略</span>
              <select :value="settings.removePolicy" :disabled="settingsBusy" @change="patchSettings({ removePolicy: ($event.target as HTMLSelectElement).value === 'keep' ? 'keep' : 'trash' })">
                <option value="trash">移入回收站（可恢复）</option>
                <option value="keep">保留目录</option>
              </select>
            </label>
          </div>
        </section>

        <section class="settings-section">
          <div class="settings-heading">
            <h3>私有仓库令牌</h3>
            <span>按 host 保存到系统密钥加密的 credentials.json；TFS 使用 PAT，HTTP 地址会提示明文风险</span>
          </div>
          <form class="settings-add" @submit.prevent="saveToken">
            <UiInput v-model="tokenHost" placeholder="host，例如 tfs.example.local:8080" />
            <UiInput v-model="tokenValue" type="password" placeholder="PAT（只写，不回显）" />
            <UiButton size="small" type="primary" :loading="tokenBusy" :disabled="!tokenHost.trim() || !tokenValue.trim()" @click="saveToken">
              保存令牌
            </UiButton>
          </form>
          <p class="settings-hint">
            GitHub 也可继续使用环境变量 GITHUB_TOKEN / GH_TOKEN；已保存令牌优先按 host 读取。
          </p>
          <div v-if="tokenState?.hosts.length" class="settings-list">
            <div v-for="item in tokenState.hosts" :key="item.host" class="settings-row">
              <div class="settings-main">
                <strong>{{ item.host }}</strong>
                <span class="settings-meta">{{ item.sealed ? '已加密保存' : '环境/明文存储' }} · 更新于 {{ new Date(item.updatedAt).toLocaleString() }}</span>
              </div>
              <UiButton size="small" text :disabled="tokenBusy" @click="removeToken(item.host)">
                删除
              </UiButton>
            </div>
          </div>
        </section>
      </div>
      <template #footer>
        <UiButton size="small" @click="settingsOpen = false">
          关闭
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog v-model="installOpen" title="安装技能" width="640px">
      <div class="install-dialog">
        <div class="install-source-row">
          <UiInput
            v-model="installSource"
            placeholder="owner/repo、GitHub URL、TFS /_git/ 地址或本地目录"
          />
          <UiInput
            v-model="installRef"
            class="install-ref"
            placeholder="ref（可选）"
          />
          <UiButton size="small" :loading="installResolving" @click="resolveInstallSource()">
            解析
          </UiButton>
        </div>
        <div class="install-target-row">
          <span class="install-target-label">安装到</span>
          <button
            type="button"
            class="install-target"
            :class="{ 'is-active': installTarget === 'global' }"
            @click="installTarget = 'global'"
          >
            全局
          </button>
          <button
            type="button"
            class="install-target"
            :class="{ 'is-active': installTarget === 'project' }"
            :disabled="!projectTargetAvailable"
            @click="installTarget = 'project'"
          >
            当前项目{{ projectScope ? ` · ${projectScope.scope.label}` : '' }}
          </button>
          <span class="install-target-hint">
            {{ installTarget === 'project' ? '写入项目 .agents/skills 与 skills-lock.json' : '写入 ~/.agents/skills 与全局锁' }}
          </span>
        </div>
        <p class="install-hint">
          解析只读远端目录，不会安装。支持 GitHub、通用 git/TFS 与本地目录；根目录的 SKILL.md 视为单技能。
        </p>
        <p v-if="installError" class="install-error">
          {{ installError }}
        </p>
        <div v-if="installCatalog" class="install-catalog">
          <div class="install-catalog-head">
            <span class="install-catalog-name">{{ installCatalog.displayName }}</span>
            <span class="install-catalog-meta">
              {{ installCatalog.sourceType }} · {{ installCatalog.entries.length }} 个技能 · {{ installCatalog.resolvedRef }}
            </span>
          </div>
          <p v-for="warning in installCatalog.warnings" :key="warning" class="install-warning">
            {{ warning }}
          </p>
          <div class="install-list" role="group" aria-label="选择要安装的技能">
            <label
              v-for="entry in installCatalog.entries"
              :key="entry.skillPath"
              class="install-item"
            >
              <input
                type="checkbox"
                :checked="installSelectedNames.has(entry.name)"
                @change="toggleInstallName(entry.name)"
              >
              <span class="install-item-name">{{ entry.name }}</span>
              <span class="install-item-path">{{ entry.skillPath }}</span>
            </label>
          </div>
          <p v-if="!installCatalog.entries.length" class="install-empty">
            来源里没有找到技能。
          </p>
        </div>
        <p v-else-if="!installResolving" class="install-empty">
          填写来源后点「解析」，再勾选要安装的技能。
        </p>
        <p v-if="installResult?.warnings.length" class="install-warning">
          {{ installResult.warnings.join('；') }}
        </p>
      </div>
      <template #footer>
        <UiButton size="small" @click="installOpen = false">
          取消
        </UiButton>
        <UiButton
          size="small"
          type="primary"
          :loading="installing"
          :disabled="!installCatalog || installSelectedCount === 0"
          @click="installSelected"
        >
          {{ installButtonLabel }}
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog v-model="planOpen" :title="planTitle" width="720px">
      <div class="plan-dialog">
        <div v-if="planCheckingGroupKey" class="plan-loading">
          <UiIcon name="refresh" :size="18" />
          <span>正在读取远端目录并对比锁内哈希…</span>
        </div>
        <div v-else-if="!plan" class="plan-error-block">
          <p class="plan-error">
            {{ planError || '没有生成更新计划' }}
          </p>
          <p class="plan-footnote">
            网络失败、403 或超时不会生成删除项；请稍后重试。
          </p>
        </div>
        <template v-else>
          <p v-if="planError" class="plan-error">
            {{ planError }}
          </p>
          <div v-if="planResult" class="plan-result">
            已更新 {{ planResult.updated.length }} 个、移除 {{ planResult.removed.length }} 个{{ planResult.skipped.length ? `，跳过 ${planResult.skipped.length} 个` : '' }}。
            <span v-if="lastPlanHistoryId">可撤销本次操作。</span>
          </div>
          <div v-if="planUndoResult" class="plan-result is-undo">
            已恢复 {{ planUndoResult.restored.length }} 个技能与对应锁记录。
          </div>
          <UpdatePlanPanel
            :plan="plan"
            :selected="planSelected"
            :disabled="planApplying"
            @toggle="togglePlanItem"
          />
          <p v-if="planResult?.warnings.length" class="plan-warning">
            {{ planResult.warnings.join('；') }}
          </p>
        </template>
      </div>
      <template #footer>
        <UiButton size="small" @click="planOpen = false">
          关闭
        </UiButton>
        <UiButton v-if="planCanUndo" size="small" :loading="planApplying" @click="undoPlan">
          撤销本次
        </UiButton>
        <UiButton
          v-if="plan"
          size="small"
          type="primary"
          :loading="planApplying"
          :disabled="!planCanApply"
          @click="applyPlan"
        >
          应用选中（{{ planSelectedCount }}）
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog v-model="trashOpen" title="回收站" width="720px">
      <div class="trash-dialog">
        <div v-if="trashLoading" class="plan-loading">
          <UiIcon name="refresh" :size="18" />
          <span>正在读取回收站…</span>
        </div>
        <p v-else-if="trashError" class="plan-error">
          {{ trashError }}
        </p>
        <template v-else-if="trash">
          <div class="trash-summary">
            <span>{{ trash.items.length }} 个条目 · {{ formatBytes(trash.totalBytes) }}</span>
            <span>保留策略：{{ trash.retentionDays }} 天 / {{ formatBytes(trash.maxBytes) }}</span>
          </div>
          <UiSwitchField
            v-if="settings"
            :model-value="settings.autoReDisable"
            :disabled="settingsBusy"
            @update:model-value="saveAutoReDisable"
          >
            下次扫描时自动重新禁用冲突技能
          </UiSwitchField>
          <div v-if="trash.items.length" class="trash-list">
            <div v-for="item in trash.items" :key="`${item.operationId}:${item.name}`" class="trash-item">
              <div class="trash-main">
                <span class="trash-name">{{ item.name }}</span>
                <span class="trash-meta">
                  {{ item.reason }} · {{ item.scopeId }} · {{ item.ageDays }} 天前 · {{ formatBytes(item.sizeBytes) }}
                </span>
              </div>
              <div class="trash-actions">
                <UiButton size="small" :loading="trashBusyKey === `${item.operationId}:${item.name}`" :disabled="!item.restorable" @click="restoreTrash(item)">
                  {{ item.restorable ? '恢复' : '目标占用' }}
                </UiButton>
                <UiButton size="small" text @click="deleteTrash(item)">
                  永久删除
                </UiButton>
              </div>
            </div>
          </div>
          <UiEmpty v-else center icon="trash" title="回收站是空的" description="卸载、更新替换或上游删除的旧目录会出现在这里。" />
        </template>
      </div>
      <template #footer>
        <UiButton size="small" @click="trashOpen = false">
          关闭
        </UiButton>
        <UiButton size="small" :disabled="!trash?.items.length" @click="clearTrash">
          清空回收站
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog v-model="removedOpen" title="已移除" width="680px">
      <div class="removed-dialog">
        <div v-if="removedLoading" class="plan-loading">
          <UiIcon name="refresh" :size="18" />
          <span>正在读取已移除记录…</span>
        </div>
        <p v-else-if="removedError" class="plan-error">
          {{ removedError }}
        </p>
        <template v-else-if="removed.length">
          <p class="removed-note">
            墓碑只记录来源与最后基线；重新安装会重新拉取来源，遗忘只删除这条记录。
          </p>
          <div class="trash-list">
            <div v-for="item in removed" :key="`${item.scopeId}:${item.name}`" class="trash-item">
              <div class="trash-main">
                <span class="trash-name">{{ item.name }}</span>
                <span class="trash-meta">
                  {{ removedReasonLabel(item.removedReason) }} · {{ item.origin.sourceType }} · {{ item.removedAt.slice(0, 10) }}
                </span>
                <span class="removed-source">{{ item.origin.source || '来源未知' }}</span>
              </div>
              <div class="trash-actions">
                <UiButton
                  size="small"
                  :loading="removedBusyKey === `${item.scopeId}:${item.name}`"
                  :disabled="!item.origin.source"
                  @click="reinstallRemoved(item)"
                >
                  重新安装
                </UiButton>
                <UiButton size="small" text @click="forgetRemoved(item)">
                  遗忘
                </UiButton>
              </div>
            </div>
          </div>
        </template>
        <UiEmpty v-else center icon="layers" title="没有已移除记录" text="卸载、上游删除或外部删除的技能会保留墓碑。" />
      </div>
      <template #footer>
        <UiButton size="small" @click="removedOpen = false">
          关闭
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog v-model="adoptOpen" title="接管未托管技能" width="640px">
      <div class="adopt-dialog">
        <div v-if="adoptTarget" class="adopt-target">
          <span class="trash-name">{{ adoptTarget.name }}</span>
          <span class="mono">{{ adoptTarget.dirName }}/SKILL.md</span>
        </div>
        <div class="adopt-modes">
          <button type="button" class="preset-mode" :class="{ 'is-active': adoptMode === 'source' }" @click="adoptMode = 'source'">
            绑定来源
          </button>
          <button type="button" class="preset-mode" :class="{ 'is-active': adoptMode === 'local' }" @click="adoptMode = 'local'">
            仅本地
          </button>
        </div>
        <template v-if="adoptMode === 'source'">
          <label class="preset-description">
            <span>来源</span>
            <UiInput v-model="adoptInput" placeholder="owner/repo、Git URL、本地目录或 TFS _git URL" />
          </label>
          <div class="preset-form-grid">
            <label>
              <span>ref（可选）</span>
              <UiInput v-model="adoptRef" placeholder="main / GBmain" />
            </label>
            <label>
              <span>skillPath（可选）</span>
              <UiInput v-model="adoptPath" placeholder="skills/foo/SKILL.md" />
            </label>
          </div>
          <p class="removed-note">
            绑定来源会写项目锁与基线；之后可以按正常流程检查更新。
          </p>
        </template>
        <p v-else class="removed-note">
          仅本地接管不写锁，也不会参与远端更新；之后仍可补充来源。
        </p>
        <p v-if="adoptError" class="plan-error">
          {{ adoptError }}
        </p>
      </div>
      <template #footer>
        <UiButton size="small" @click="adoptOpen = false">
          取消
        </UiButton>
        <UiButton size="small" type="primary" :loading="adoptBusy" :disabled="adoptMode === 'source' && !adoptInput.trim()" @click="adoptSkill">
          接管
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog v-model="presetCreateOpen" title="新建技能预设" width="640px">
      <div class="preset-dialog">
        <div class="preset-form-grid">
          <label>
            <span>名称</span>
            <UiInput v-model="presetName" placeholder="例如：前端交付技能" />
          </label>
          <label>
            <span>默认模式</span>
            <div class="preset-mode-row">
              <button type="button" class="preset-mode" :class="{ 'is-active': presetCreateMode === 'additive' }" @click="presetCreateMode = 'additive'">
                增量
              </button>
              <button type="button" class="preset-mode" :class="{ 'is-active': presetCreateMode === 'exact' }" @click="presetCreateMode = 'exact'">
                精确
              </button>
            </div>
          </label>
        </div>
        <label class="preset-description">
          <span>描述</span>
          <UiInput v-model="presetDescription" placeholder="可选；说明这份清单的用途" />
        </label>
        <div class="preset-items-head">
          <span>包含 {{ presetDraftItems.length }} 个技能</span>
          <span class="preset-dialog-note">取消勾选只从预设移除，不影响已安装技能。</span>
        </div>
        <div class="preset-item-list">
          <label v-for="item in presetDraftItems" :key="item.key" class="preset-item">
            <UiCheckbox v-model="item.enabled" />
            <span class="preset-item-name">{{ item.name }}</span>
            <span class="mono preset-item-source">{{ item.origin.source }}</span>
            <UiChip tone="neutral">{{ item.origin.sourceType }}</UiChip>
          </label>
        </div>
        <UiEmpty v-if="presetDraftItems.length === 0" center icon="layers" title="当前范围没有可保存的技能" text="先安装或接管技能，再创建预设。" />
      </div>
      <template #footer>
        <UiButton size="small" @click="presetCreateOpen = false">
          取消
        </UiButton>
        <UiButton size="small" type="primary" :loading="presetSaving" :disabled="!presetDraftItems.some(item => item.enabled)" @click="savePreset">
          保存预设
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog v-model="presetApplyOpen" title="应用技能预设" width="640px">
      <div class="preset-dialog">
        <div class="preset-target-row">
          <span>应用目标</span>
          <button type="button" class="preset-target" :class="{ 'is-active': presetApplyTarget === 'global' }" @click="presetApplyTarget = 'global'">
            全局
          </button>
          <button type="button" class="preset-target" :class="{ 'is-active': presetApplyTarget === 'project' }" @click="presetApplyTarget = 'project'">
            当前项目
          </button>
          <button type="button" class="preset-target" :class="{ 'is-active': presetApplyTarget === 'custom' }" @click="presetApplyTarget = 'custom'">
            指定目录
          </button>
        </div>
        <UiInput
          v-if="presetApplyTarget !== 'global'"
          v-model="presetApplyPath"
          placeholder="项目根目录或目标目录（默认写入 <path>/.agents/skills）"
        />
        <div class="preset-mode-row">
          <button type="button" class="preset-mode" :class="{ 'is-active': presetApplyMode === 'additive' }" @click="presetApplyMode = 'additive'; presetApplyExactAck = false">
            增量安装
          </button>
          <button type="button" class="preset-mode" :class="{ 'is-active': presetApplyMode === 'exact' }" @click="presetApplyMode = 'exact'">
            精确同步
          </button>
        </div>
        <label v-if="presetApplyMode === 'exact'" class="preset-exact-confirm">
          <UiCheckbox v-model="presetApplyExactAck" />
          我确认移除目标中预设之外的已托管技能（会进入回收站）
        </label>
        <label v-if="presetApplyTarget !== 'global'" class="preset-exact-confirm">
          <UiCheckbox v-model="presetApplyRegister" />
          同时登记为目标项目
        </label>
        <p v-if="presetApplyError" class="plan-error">
          {{ presetApplyError }}
        </p>
        <div v-if="presetApplyResult" class="plan-result">
          安装 {{ presetApplyResult.installed.length }}、更新 {{ presetApplyResult.updated.length }}、移除 {{ presetApplyResult.removed.length }}、不可用 {{ presetApplyResult.unavailable.length }}。
          <span v-if="presetApplyResult.warnings.length"> {{ presetApplyResult.warnings.join('；') }}</span>
        </div>
      </div>
      <template #footer>
        <UiButton size="small" @click="presetApplyOpen = false">
          关闭
        </UiButton>
        <UiButton size="small" type="primary" :loading="presetApplying" @click="applyPreset">
          应用预设
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog v-model="presetImportOpen" title="导入预设 JSON" width="640px">
      <div class="preset-dialog">
        <textarea v-model="presetImportText" class="preset-import-text" placeholder="粘贴导出的 presets.json 内容" />
        <p v-if="presetImportError" class="plan-error">
          {{ presetImportError }}
        </p>
        <p class="preset-dialog-note">
          导入只新增/覆盖预设，不会自动安装技能。
        </p>
      </div>
      <template #footer>
        <UiButton size="small" @click="presetImportOpen = false">
          取消
        </UiButton>
        <UiButton size="small" type="primary" :disabled="!presetImportText.trim()" @click="importPresets">
          导入
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped lang="scss">
.skill-manager-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.skill-surface {
  min-height: 0;
}

.tb-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.tb-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
}

.tb-state.is-success {
  color: var(--color-success);

  .tb-dot {
    background: var(--color-success);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-success) 14%, transparent);
  }
}

.tb-state.is-warning {
  color: var(--color-warning);

  .tb-dot {
    background: var(--color-warning);
  }
}

.tb-state.is-danger {
  color: var(--color-error);

  .tb-dot {
    background: var(--color-error);
  }
}

.surface-toolbar-content {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  width: 100%;
  min-width: 0;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.filter-chip {
  height: 26px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: var(--font-size-xs);
  white-space: nowrap;
  cursor: pointer;

  span {
    margin-left: 3px;
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  &:hover {
    background: var(--color-fill);
    color: var(--color-text-primary);
  }

  &.is-active {
    border-color: var(--color-border-light);
    background: var(--color-raised);
    color: var(--color-text-primary);
  }
}

.toolbar-spacer { flex: 1; }

.toolbar-note {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.toolbar-meta {
  flex: none;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.surface-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.scope-pane {
  display: flex;
  flex: 0 0 218px;
  flex-direction: column;
  width: 218px;
  min-height: 0;
  padding: 12px 10px;
  overflow: auto;
  border-right: 1px solid var(--color-border-light);
  background: color-mix(in srgb, var(--color-fill) 34%, transparent);
}

.pane-label {
  margin: 2px 8px 7px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: var(--font-weight-medium);
  letter-spacing: .06em;
  text-transform: uppercase;
}

.scope-row,
.filter-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: var(--font-size-xs);
  text-align: left;
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--color-on-solid) 40%, transparent);
    color: var(--color-text-primary);
  }

  &.is-active {
    border-color: color-mix(in srgb, var(--color-primary) 17%, transparent);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    color: var(--color-text-primary);
  }
}

.scope-row .ui-icon { color: var(--color-text-tertiary); }
.scope-row.is-active .ui-icon { color: var(--color-primary-strong); }

.scope-num {
  margin-left: auto;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.scope-lock {
  margin-left: auto;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.scope-lock + .scope-num { margin-left: 6px; }

.scope-sub {
  display: grid;
  gap: 1px;
  margin: 2px 0 0 22px;

  button {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 27px;
    padding: 0 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--color-text-tertiary);
    font-family: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;

    &:hover { background: color-mix(in srgb, var(--color-on-solid) 40%, transparent); color: var(--color-text-primary); }
    &.is-active { color: var(--color-text-primary); }
  }
}

.scope-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
}

.pane-rule {
  height: 1px;
  margin: 11px 8px;
  background: var(--color-border-light);
}

.filter-row {
  height: 29px;
  gap: 6px;
}

.filter-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-tertiary);

  &.is-warning { background: var(--color-warning); }
  &.is-danger { background: var(--color-error); }
}

.pane-hint {
  margin: auto 4px 0;
  padding: 8px;
  border: 1px solid var(--color-border-light);
  border-radius: 8px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 1.5;
}

.view-stack {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.table-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.skill-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;

  col.col-skill { width: 46%; }
  col.col-state { width: 14%; }
  col.col-source { width: 26%; }
  col.col-action { width: 14%; }

  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    height: 34px;
    padding: 0 12px;
    border-bottom: 1px solid var(--color-border-light);
    background: color-mix(in srgb, var(--color-raised) 92%, var(--color-fill));
    color: var(--color-text-tertiary);
    font-size: 11px;
    font-weight: var(--font-weight-medium);
    text-align: left;
    white-space: nowrap;
  }

  tbody td {
    height: 46px;
    padding: 5px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border-light) 66%, transparent);
    vertical-align: middle;
  }

  tbody tr.skill-row:hover td {
    background: color-mix(in srgb, var(--color-on-solid) 36%, transparent);
  }
}

.group-row td {
  height: 42px !important;
  padding: 0 12px !important;
  border-top: 1px solid var(--color-border-light);
  border-bottom: 1px solid var(--color-border-light) !important;
  background: color-mix(in srgb, var(--color-fill) 52%, transparent);
}

.group-line {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.group-toggle,
.group-toggle-spacer {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
}

.group-toggle {
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;

  &:hover { background: color-mix(in srgb, var(--color-on-solid) 46%, transparent); color: var(--color-text-primary); }
  .ui-icon { transition: transform var(--transition-fast); }
  .ui-icon.is-collapsed { transform: rotate(-90deg); }
}

.group-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 23px;
  height: 23px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, var(--color-border-light));
  border-radius: 7px;
  background: color-mix(in srgb, var(--color-primary) 7%, transparent);
  color: var(--color-primary-strong);
}

.group-name {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
}

.group-host {
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}

.group-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  white-space: nowrap;

  &.is-warning { color: var(--color-warning); }
}

.group-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.cell-skill { min-width: 0; }

.skill-main {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.indent { width: 18px; flex: none; }

.skill-name {
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.skill-desc {
  overflow: hidden;
  margin: 1px 0 0 25px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.state-text {
  font-size: var(--font-size-xs);
  white-space: nowrap;

  &.is-success { color: var(--color-success); }
  &.is-warning { color: var(--color-warning); }
  &.is-danger { color: var(--color-error); }
  &.is-neutral { color: var(--color-text-tertiary); }
}

.path {
  display: -webkit-box;
  overflow: hidden;
  max-height: 2.5em;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.25;
  word-break: break-all;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 1px;
  opacity: .62;
  transition: opacity var(--transition-fast);
}

.skill-row:hover .row-actions,
.skill-row:focus-within .row-actions {
  opacity: 1;
}

.star-button {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;

  &:hover { background: var(--color-fill); color: var(--color-text-primary); }
  &.is-on { color: var(--color-warning); }
  &.is-on :deep(path) { fill: currentColor; }
}

.install-dialog {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.install-source-row {
  display: flex;
  align-items: center;
  gap: 8px;

  :deep(.ui-input) { flex: 1; min-width: 0; }
  .install-ref { flex: 0 0 150px; }
}

.install-target-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  row-gap: 4px;
  min-width: 0;
}

.install-target-label {
  flex: none;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.install-target {
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--color-border-light);
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: var(--color-border);
    color: var(--color-text-primary);
  }

  &.is-active {
    border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border-light));
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-primary);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
}

.install-target-hint {
  flex: 1 1 160px;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.install-hint,
.install-empty {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  line-height: 1.65;
}

.install-error {
  margin: 0;
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--color-error) 26%, var(--color-border-light));
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--color-error) 7%, transparent);
  color: var(--color-error);
  font-size: var(--font-size-xs);
  line-height: 1.55;
}

.install-catalog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.install-catalog-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-top: 2px;
  border-top: 1px solid var(--color-border-light);
}

.install-catalog-name {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.install-catalog-meta {
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.install-warning {
  margin: 0;
  color: var(--color-warning);
  font-size: var(--font-size-xs);
  line-height: 1.55;
}

.install-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px
    ;
  max-height: 280px;
  padding: 4px;
  overflow: auto;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-control);
  background: var(--color-field);
}

.install-item {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 5px 7px;
  border-radius: 6px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;

  &:hover { background: var(--color-fill); color: var(--color-text-primary); }

  input { flex: none; accent-color: var(--color-primary); }
}

.install-item-name {
  flex: none;
  max-width: 58%;
  overflow: hidden;
  color: var(--color-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.install-item-path {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 560px) {
  .install-source-row { flex-wrap: wrap; }
  .install-source-row .install-ref { flex: 1 1 120px; }
  .install-list { grid-template-columns: minmax(0, 1fr); }
}

.updates-view {
  display: flex;
  flex: 1;
  justify-content: center;
  min-height: 0;
  padding: 8px 4px;
  overflow: auto;
}

.updates-plan {
  display: grid;
  align-content: start;
  gap: 12px;
  width: min(860px, 100%);
}

.updates-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;

  h2 {
    margin: 0 0 3px;
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-medium);
  }

  p {
    margin: 0;
    color: var(--color-text-tertiary);
    font-size: var(--font-size-xs);
    line-height: 1.6;
  }
}

.updates-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  padding-top: 2px;
}

.updates-count {
  margin-right: auto;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.plan-dialog {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.plan-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 130px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);

  .ui-icon { animation: plan-spin 1s linear infinite; }
}

@keyframes plan-spin {
  to { transform: rotate(360deg); }
}

.plan-error-block {
  display: grid;
  gap: 6px;
}

.plan-error {
  margin: 0;
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--color-error) 26%, var(--color-border-light));
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--color-error) 7%, transparent);
  color: var(--color-error);
  font-size: var(--font-size-xs);
  line-height: 1.55;
}

.plan-result {
  padding: 7px 9px;
  border: 1px solid color-mix(in srgb, var(--color-success) 24%, var(--color-border-light));
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--color-success) 7%, transparent);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: 1.55;

  &.is-undo {
    border-color: var(--color-border-light);
    background: var(--color-fill);
  }
}

.plan-warning {
  margin: 0;
  color: var(--color-warning);
  font-size: var(--font-size-xs);
  line-height: 1.55;
}

.plan-footnote {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 11px;
  line-height: 1.55;
}

.trash-dialog {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.trash-summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px 12px;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
}

.trash-list {
  display: grid;
  max-height: min(52vh, 430px);
  overflow: auto;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-control);
}

.trash-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 9px 11px;

  & + & { border-top: 1px solid var(--color-border-light); }
}

.trash-main {
  display: grid;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.trash-name {
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.trash-meta {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trash-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

@media (max-width: 560px) {
  .trash-item {
    align-items: flex-start;
    flex-direction: column;
  }

  .trash-actions {
    width: 100%;
    justify-content: flex-end;
  }
}

.collection-view {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.collection-side {
  display: flex;
  flex: 0 0 200px;
  flex-direction: column;
  gap: 4px;
  width: 200px;
  min-height: 0;
  padding: 12px 10px;
  overflow: auto;
  border-right: 1px solid var(--color-border-light);
  background: color-mix(in srgb, var(--color-fill) 34%, transparent);
}

.collection-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 6px 8px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.collection-filter {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  text-align: left;

  & span {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  &:hover { background: var(--color-fill); }

  &.is-active {
    border-color: color-mix(in srgb, var(--color-primary) 22%, transparent);
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
  }
}

.collection-hint {
  margin: auto 4px 0;
  padding-top: 12px;
  color: var(--color-text-tertiary);
  font-size: 10px;
  line-height: 1.6;
}

.collection-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  padding: 16px 18px;
  overflow: auto;
}

.collection-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex: none;

  h2 {
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-semibold);
  }

  p {
    margin: 3px 0 0;
    color: var(--color-text-tertiary);
    font-size: var(--font-size-xs);
    line-height: 1.55;
  }
}

.favorite-grid,
.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(276px, 1fr));
  gap: 10px;
  align-content: start;
}

.favorite-card,
.preset-card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-card);
  background: var(--color-surface);
}

.favorite-card-head,
.preset-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  strong {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.favorite-star,
.preset-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.favorite-card > p,
.preset-card-head p {
  min-height: 30px;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.preset-card-head > div {
  flex: 1;
  min-width: 0;
}

.preset-card-head p { min-height: 0; margin-top: 2px; color: var(--color-text-tertiary); }

.favorite-card-meta,
.preset-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  color: var(--color-text-tertiary);
  font-size: 10px;
}

.favorite-card-meta .mono {
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.favorite-card-foot,
.preset-card-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: auto;
  padding-top: 3px;
}

.favorite-scopes {
  margin-left: auto;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  min-height: 0;
  padding: 16px 18px;
  overflow: auto;
}

.preset-head-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.preset-card-items {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.preset-more {
  align-self: center;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 10px;
}

.preset-card-foot {
  border-top: 1px solid var(--color-border-light);
  justify-content: space-between;
}

.preset-dialog {
  display: grid;
  gap: 12px;
  min-width: 0;
  max-height: min(66vh, 640px);
  overflow: auto;
}

.preset-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.preset-form-grid label,
.preset-description {
  display: grid;
  gap: 5px;
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.preset-description { display: grid; gap: 5px; }

.preset-mode-row,
.preset-target-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.preset-target-row > span {
  margin-right: 2px;
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.preset-mode,
.preset-target {
  padding: 5px 9px;
  border: 1px solid var(--color-border-light);
  border-radius: 7px;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: 11px;

  &.is-active {
    border-color: color-mix(in srgb, var(--color-primary) 28%, transparent);
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
  }
}

.preset-items-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  color: var(--color-text-secondary);
  font-size: 11px;
}

.preset-dialog-note {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: 10px;
  line-height: 1.55;
}

.preset-item-list {
  display: grid;
  max-height: min(34vh, 280px);
  overflow: auto;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-control);
}

.preset-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 7px 9px;

  & + & { border-top: 1px solid var(--color-border-light); }
}

.preset-item-name {
  overflow: hidden;
  min-width: 0;
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-item-source {
  margin-left: auto;
  overflow: hidden;
  max-width: 42%;
  color: var(--color-text-tertiary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-exact-confirm {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 1.5;
}

.preset-import-text {
  width: 100%;
  min-height: 240px;
  padding: 10px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
  resize: vertical;
}

@media (max-width: 980px) {
  .collection-side { display: none; }
}

@media (max-width: 760px) {
  .collection-main,
  .preset-view { padding: 12px; }
  .favorite-grid,
  .preset-grid { grid-template-columns: minmax(0, 1fr); }
  .preset-form-grid { grid-template-columns: 1fr; }
  .preset-head-actions { justify-content: flex-start; }
}

.placeholder-view {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  flex: 1;
  padding: var(--spacing-2xl);
  color: var(--color-text-secondary);
  text-align: center;

  h2 { margin: 4px 0 0; font-size: var(--font-size-base); font-weight: var(--font-weight-medium); }
  p { max-width: 340px; margin: 0 0 6px; color: var(--color-text-tertiary); font-size: var(--font-size-xs); line-height: 1.65; }
}

.placeholder-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, var(--color-border-light));
  border-radius: 12px;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.removed-dialog,
.adopt-dialog { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.removed-note { margin: 0; color: var(--color-text-tertiary); font-size: var(--font-size-xs); line-height: 1.6; }
.removed-source { overflow: hidden; color: var(--color-text-tertiary); font-family: var(--font-mono); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.adopt-target { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; padding: 10px 12px; border: 1px solid var(--color-border-light); border-radius: var(--radius-md); background: var(--color-bg-secondary); }
.adopt-target .mono { overflow: hidden; color: var(--color-text-tertiary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.adopt-modes { display: flex; gap: 6px; }

.mono { font-family: var(--font-mono); }

@media (max-width: 980px) {
  .scope-pane { display: none; }
}

@media (max-width: 760px) {
  .skill-manager-page { padding: 0 10px 10px; }
  .skill-manager-page :deep(.check-all-button) { display: none; }
  .filter-group { display: none; }
  .toolbar-note { display: none; }
  .skill-table { min-width: 620px; }
  .group-host { display: none; }
}

.settings-dialog {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-height: 68vh;
  min-width: 0;
  overflow: auto;
  padding-right: 4px;
}

.settings-section {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.settings-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;

  h3 { margin: 0; font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }
  span { color: var(--color-text-tertiary); font-size: var(--font-size-xs); }
}

.settings-add {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  :deep(.ui-input) { flex: 1; min-width: 0; }
}

.settings-list {
  display: grid;
  gap: 6px;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 9px 11px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
}

.settings-main {
  display: grid;
  gap: 3px;
  min-width: 0;

  strong { font-size: var(--font-size-xs); font-weight: var(--font-weight-medium); }
}

.settings-path,
.settings-meta {
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-meta { font-family: inherit; }

.settings-actions { display: flex; flex: 0 0 auto; gap: 4px; }

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.settings-field {
  display: grid;
  gap: 5px;
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);

  select,
  input {
    width: 100%;
    min-width: 0;
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--color-border-light);
    border-radius: var(--radius-control);
    background: var(--color-surface);
    color: var(--color-text-primary);
    font: inherit;
  }
}

.settings-error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--font-size-xs);
}

.settings-hint {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  line-height: 1.55;
}

@media (max-width: 760px) {
  .settings-add { flex-wrap: wrap; }
  .settings-add :deep(.ui-input) { flex: 1 1 100%; }
  .settings-grid { grid-template-columns: 1fr; }
  .settings-row { align-items: flex-start; flex-direction: column; }
}

.projects-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  padding: 18px 20px;
  overflow: auto;
}

.projects-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;

  h2 { margin: 0 0 4px; font-size: var(--font-size-base); font-weight: var(--font-weight-medium); }
  p { max-width: 620px; margin: 0; color: var(--color-text-tertiary); font-size: var(--font-size-xs); line-height: 1.6; }
}

.projects-add {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  :deep(.ui-input) { flex: 1; min-width: 0; }
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.project-card {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}

.project-card-head {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-width: 0;

  > div { display: grid; gap: 3px; min-width: 0; }
  strong { overflow: hidden; font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); text-overflow: ellipsis; white-space: nowrap; }
  span:not(.project-icon) { overflow: hidden; color: var(--color-text-tertiary); font-family: var(--font-mono); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
}

.project-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--color-primary-soft);
  color: var(--color-primary-strong);
}

.project-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  color: var(--color-text-tertiary);
  font-size: 11px;
}

.project-card-foot {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  padding-top: 2px;
}

@media (max-width: 760px) {
  .projects-view { padding: 12px; }
  .projects-add { flex-wrap: wrap; }
  .projects-add :deep(.ui-input) { flex: 1 1 100%; }
  .projects-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
