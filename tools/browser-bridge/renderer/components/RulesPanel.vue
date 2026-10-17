<script setup lang="ts">
import type { BridgeRule, HeaderAction, HeaderOperation, QueryParamAction, QueryParamModification, RequestBodyMode, RequestRuleConfig, RuleFilters, RuleOperator, RuleSourceKey, RuleType, ScriptRunAt, ScriptWorld } from '../../../../shared/browser-bridge'
import { REQUEST_METHODS, RESOURCE_TYPE_LABELS, RULE_DELAY_MAX_MS, RULE_TYPE_LABELS } from '../../../../shared/browser-bridge'
import { useBrowserBridgeStore } from '../stores/browserBridgeStore'
import { RULE_TYPES, ruleTypeFromPath, ruleTypeRouteName } from '../tabs'

const route = useRoute()
const router = useRouter()
const store = useBrowserBridgeStore()

const pickerVisible = ref(false)
const view = ref<'list' | 'editor'>('list')
const isExistingDraft = ref(false)
const draft = ref<BridgeRule | null>(null)
const ifCardCollapsed = ref(false)
const filterPanelOpen = ref(false)
const editingName = ref(false)
const editingDescription = ref(false)
const redirectTargetType = ref<'url' | 'local' | 'fileserver'>('url')

// ─────────────────────────────────────────────────────────────
// 规则列表（对齐 Requestly my-rules 的 content-list 布局）
// ─────────────────────────────────────────────────────────────

type FilterKey = 'all' | 'pinned' | 'active'
type SortKey = 'name' | 'type' | 'updated'

const filterOptions: Array<{ key: FilterKey, label: string, icon?: 'pin' | 'toggle' }> = [
  { key: 'all', label: '全部' },
  { key: 'pinned', label: '已固定', icon: 'pin' },
  { key: 'active', label: '已启用', icon: 'toggle' },
]

const activeFilter = ref<FilterKey>('all')
const searchValue = ref('')
const sortKey = ref<SortKey | null>(null)
const sortDir = ref<'asc' | 'desc'>('asc')
const selectedIds = ref(new Set<string>())

// 规则类型过滤走路由（/tools/browser-bridge/rules/<type>）：URL 可深链
const activeType = computed<RuleType | null>(() => ruleTypeFromPath(route.path))

const ruleTypeFilterOptions: Array<{ value: RuleType | null, label: string }> = [
  { value: null, label: '全部类型' },
  ...RULE_TYPES.map(type => ({ value: type, label: RULE_TYPE_LABELS[type] })),
]

function selectRuleType(type: RuleType | null): void {
  router.push(type ? { name: ruleTypeRouteName(type) } : { name: 'tool-browser-bridge-rules' })
}

/** 面包屑「规则」：清空本地过滤并回到全部类型路由 */
function resetToList(): void {
  activeFilter.value = 'all'
  searchValue.value = ''
  if (activeType.value) router.push({ name: 'tool-browser-bridge-rules' })
}

const activeFilterLabel = computed(() => filterOptions.find(option => option.key === activeFilter.value)?.label ?? '全部')

const filterCounts = computed<Record<FilterKey, number>>(() => ({
  all: store.rules.length,
  pinned: store.rules.filter(rule => rule.pinned).length,
  active: store.rules.filter(rule => rule.enabled).length,
}))

const visibleRules = computed<BridgeRule[]>(() => {
  let list = store.rules
  if (activeType.value) list = list.filter(rule => rule.type === activeType.value)
  if (activeFilter.value === 'pinned') list = list.filter(rule => rule.pinned)
  else if (activeFilter.value === 'active') list = list.filter(rule => rule.enabled)

  const keyword = searchValue.value.trim().toLowerCase()
  if (keyword) {
    list = list.filter(rule => rule.name.toLowerCase().includes(keyword) || rule.source.value.toLowerCase().includes(keyword))
  }

  const key = sortKey.value
  if (!key) return list
  const direction = sortDir.value === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name, 'zh') * direction
    if (key === 'type') return RULE_TYPE_LABELS[a.type].localeCompare(RULE_TYPE_LABELS[b.type], 'zh') * direction
    return (a.updatedAt < b.updatedAt ? -1 : 1) * direction
  })
})

const selectedRules = computed(() => store.rules.filter(rule => selectedIds.value.has(rule.id)))
const allVisibleSelected = computed(() => visibleRules.value.length > 0 && visibleRules.value.every(rule => selectedIds.value.has(rule.id)))
const someVisibleSelected = computed(() => visibleRules.value.some(rule => selectedIds.value.has(rule.id)))
const bulkAllEnabled = computed(() => selectedRules.value.length > 0 && selectedRules.value.every(rule => rule.enabled))

function sortState(key: SortKey): 'asc' | 'desc' | null {
  return sortKey.value === key ? sortDir.value : null
}

function cycleSort(key: SortKey): void {
  if (sortKey.value !== key) {
    sortKey.value = key
    sortDir.value = 'asc'
    return
  }
  if (sortDir.value === 'asc') {
    sortDir.value = 'desc'
    return
  }
  sortKey.value = null
  sortDir.value = 'asc'
}

function isSelected(rule: BridgeRule): boolean {
  return selectedIds.value.has(rule.id)
}

function toggleSelect(rule: BridgeRule): void {
  if (selectedIds.value.has(rule.id)) selectedIds.value.delete(rule.id)
  else selectedIds.value.add(rule.id)
}

function toggleSelectAll(): void {
  if (allVisibleSelected.value) visibleRules.value.forEach(rule => selectedIds.value.delete(rule.id))
  else visibleRules.value.forEach(rule => selectedIds.value.add(rule.id))
}

function clearSelection(): void {
  selectedIds.value.clear()
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('zh-CN')
}

const typeIcons: Record<RuleType, string[]> = {
  redirect: ['M3.5 15.5v-5a4 4 0 0 1 4-4h8', 'M12.5 3.5l3 3-3 3'],
  replace: ['M4 7h11l-2.8-2.8', 'M16 13H5l2.8 2.8'],
  queryParam: ['M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z', 'M7.9 8a2.2 2.2 0 1 1 3 2.2c-.6.3-.9.8-.9 1.4', 'M10 14.4v.01'],
  cancel: ['M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z', 'M4.9 4.9l10.2 10.2'],
  delay: ['M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z', 'M10 6v4.2l2.8 1.7'],
  headers: ['M3.5 5.5h13', 'M3.5 10h13', 'M3.5 14.5h7'],
  userAgent: ['M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M4 16.5a6 6 0 0 1 12 0'],
  request: ['M10 13.5v-10', 'M6.5 7L10 3.5 13.5 7', 'M3.5 16.5h13'],
  response: ['M10 3.5v10', 'M6.5 10l3.5 3.5L13.5 10', 'M3.5 16.5h13'],
  script: ['M7.6 6.6 4.2 10l3.4 3.4', 'M12.4 6.6 15.8 10l-3.4 3.4'],
}

async function togglePin(rule: BridgeRule): Promise<void> {
  await store.upsertRule({ ...rule, pinned: !rule.pinned || undefined })
}

async function duplicateRule(rule: BridgeRule): Promise<void> {
  const copy: BridgeRule = {
    ...structuredClone(toRaw(rule)),
    id: crypto.randomUUID(),
    name: `${rule.name} 副本`,
    pinned: undefined,
    updatedAt: new Date().toISOString(),
  }
  await store.upsertRule(copy)
  ElMessage.success('已复制规则')
}

function handleRuleAction(command: string, rule: BridgeRule): void {
  if (command === 'duplicate') void duplicateRule(rule)
  else if (command === 'delete') void remove(rule)
}

async function bulkToggleEnabled(): Promise<void> {
  const target = !bulkAllEnabled.value
  const rules = selectedRules.value
  for (const rule of rules) {
    await store.upsertRule({ ...rule, enabled: target, updatedAt: new Date().toISOString() })
  }
  ElMessage.success(`${target ? '已启用' : '已停用'} ${rules.length} 条规则`)
}

async function bulkDelete(): Promise<void> {
  const rules = selectedRules.value
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${rules.length} 条规则？`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  for (const rule of rules) {
    await store.deleteRule(rule.id)
    selectedIds.value.delete(rule.id)
  }
  ElMessage.success('已删除选中规则')
}

// ─────────────────────────────────────────────────────────────
// 规则编辑器（保持原有分类型编辑流程）
// ─────────────────────────────────────────────────────────────

const keyOptions: Array<{ value: RuleSourceKey, label: string }> = [
  { value: 'url', label: 'URL' },
  { value: 'host', label: 'Host' },
  { value: 'path', label: 'Path' },
]

const operatorOptions: Array<{ value: RuleOperator, label: string }> = [
  { value: 'equals', label: '等于' },
  { value: 'contains', label: '包含' },
  { value: 'matches', label: '正则匹配' },
  { value: 'wildcard', label: '通配符（* 匹配任意）' },
]

const headerActionOptions: Array<{ value: HeaderAction, label: string }> = [
  { value: 'override', label: '覆盖 / 设置' },
  { value: 'add', label: '追加' },
  { value: 'remove', label: '移除' },
]

interface TypeOption { type: RuleType, icon: string[], title: string, desc: string }

// 分组对齐 Requestly New Rule 下拉：URL rewrites / API mocking / Headers / Others
const typeGroups: Array<{ title: string, options: TypeOption[] }> = [
  {
    title: 'URL 改写',
    options: [
      { type: 'redirect', icon: typeIcons.redirect, title: RULE_TYPE_LABELS.redirect, desc: '把匹配请求 30x 指到其他地址' },
      { type: 'replace', icon: typeIcons.replace, title: RULE_TYPE_LABELS.replace, desc: '在 URL 串中把 A 换成 B 再请求' },
      { type: 'queryParam', icon: typeIcons.queryParam, title: RULE_TYPE_LABELS.queryParam, desc: '增 / 删 / 清空 URL 查询参数' },
    ],
  },
  {
    title: 'API Mock',
    options: [
      { type: 'request', icon: typeIcons.request, title: RULE_TYPE_LABELS.request, desc: '静态替换或动态 JS 改写请求体' },
      { type: 'response', icon: typeIcons.response, title: RULE_TYPE_LABELS.response, desc: '状态码、响应体，或不调服务器直接返回' },
    ],
  },
  {
    title: '请求头',
    options: [
      { type: 'headers', icon: typeIcons.headers, title: RULE_TYPE_LABELS.headers, desc: '增删改头字段' },
      { type: 'userAgent', icon: typeIcons.userAgent, title: RULE_TYPE_LABELS.userAgent, desc: '覆盖 UA（模拟机型 / 环境）' },
    ],
  },
  {
    title: '其他',
    options: [
      { type: 'script', icon: typeIcons.script, title: RULE_TYPE_LABELS.script, desc: '在匹配页面注入自定义 JS（URL 留空 = 所有页面）' },
      { type: 'cancel', icon: typeIcons.cancel, title: RULE_TYPE_LABELS.cancel, desc: '拦截并断开连接' },
      { type: 'delay', icon: typeIcons.delay, title: RULE_TYPE_LABELS.delay, desc: `延迟指定毫秒后转发（上限 ${RULE_DELAY_MAX_MS / 1000}s）` },
    ],
  },
]

function chooseTypeOption(option: TypeOption): void {
  createRule(option.type)
}

const worldOptions: Array<{ value: ScriptWorld, label: string }> = [
  { value: 'MAIN', label: 'MAIN（页面世界，可直接改页面变量）' },
  { value: 'ISOLATED', label: 'ISOLATED（扩展隔离世界，可调扩展 API）' },
]

const runAtOptions: Array<{ value: ScriptRunAt, label: string }> = [
  { value: 'document_start', label: 'document_start（DOM 前）' },
  { value: 'document_end', label: 'document_end（DOM 完成后）' },
  { value: 'document_idle', label: 'document_idle（空闲时）' },
]

const uaPresets = [
  { label: 'Android Chrome', value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36' },
  { label: 'iOS Safari', value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' },
  { label: 'Windows Chrome', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
  { label: 'macOS Safari', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15' },
]

const payloadEnabled = computed({
  get: () => !!draft.value?.filters?.requestPayload,
  set: (enabled: boolean) => {
    if (!draft.value) return
    draft.value.filters = draft.value.filters ?? {}
    draft.value.filters.requestPayload = enabled ? { key: '', operator: 'equals', value: '' } : undefined
  },
})

function keyLabel(key: RuleSourceKey): string {
  return keyOptions.find(option => option.value === key)?.label ?? key
}

function operatorLabel(operator: RuleOperator): string {
  return operatorOptions.find(option => option.value === operator)?.label ?? operator
}

function sourceSummary(rule: BridgeRule): string {
  const { key, operator, value } = rule.source
  if (rule.type === 'script' && !value.trim()) return '所有页面'
  return `${keyLabel(key)} ${operatorLabel(operator)} ${value}`
}

const CONFIG_KEYS = ['redirect', 'replace', 'queryParam', 'delay', 'headers', 'userAgent', 'request', 'response', 'script'] as const

function normalizeRequestBodyConfig(config?: RequestRuleConfig): RequestRuleConfig {
  if (!config) return { type: 'static', value: '' }
  if (config.type === undefined) {
    return { type: 'static', value: config.value ?? config.bodyReplace ?? '' }
  }
  return { type: config.type, value: config.value ?? '' }
}

function ensureDefaults(rule: BridgeRule): void {
  rule.filters = rule.filters ?? { requestMethod: [], resourceType: [], pageUrl: '' }
  switch (rule.type) {
    case 'redirect':
      rule.redirect = rule.redirect ?? { destination: '', statusCode: 302, preserveQueryParams: false }
      break
    case 'replace':
      rule.replace = rule.replace ?? { from: '', to: '' }
      break
    case 'queryParam':
      rule.queryParam = rule.queryParam ?? { modifications: [] }
      if (!rule.queryParam.modifications.length) rule.queryParam.modifications.push(emptyQueryMod())
      break
    case 'delay':
      rule.delay = rule.delay ?? { delayMs: 1000 }
      break
    case 'headers':
      rule.headers = rule.headers ?? { request: [], response: [] }
      break
    case 'userAgent':
      rule.userAgent = rule.userAgent ?? { userAgent: '' }
      break
    case 'request':
      rule.request = normalizeRequestBodyConfig(rule.request)
      break
    case 'response':
      rule.response = rule.response ?? { mock: false }
      break
    case 'script':
      rule.script = rule.script ?? { code: '', world: 'MAIN', runAt: 'document_start' }
      break
    case 'cancel':
      break
  }
}

function countActiveFilters(filters?: RuleFilters): number {
  if (!filters) return 0
  let count = 0
  if (filters.requestMethod?.length) count += 1
  if (filters.resourceType?.length) count += 1
  if (filters.pageUrl?.trim()) count += 1
  if (filters.requestPayload?.key.trim()) count += 1
  return count
}

const thenSectionLabel = computed(() => {
  if (draft.value?.type === 'redirect') return '重定向到'
  if (draft.value?.type === 'request') return '请求体'
  if (draft.value?.type === 'script') return '插入脚本'
  return '动作'
})

const ifCardLabel = computed(() => (draft.value?.type === 'script' ? 'If 页面匹配' : 'If 请求匹配'))

// ─────────────────────────────────────────────────────────────
// 请求体编辑（对齐 Requestly：静态数据 / 动态 JavaScript 两态）
// ─────────────────────────────────────────────────────────────

const REQUEST_BODY_CODE_TEMPLATE = `async function modifyRequestBody(args) {
  const { method, url, body, bodyAsJson } = args
  // Change request body below depending upon request attributes received in args

  return body
}`

const requestBodyStash = ref<{ static: string, code: string }>({ static: '', code: '' })
const requestBodyMode = computed<RequestBodyMode>(() => (draft.value?.request?.type === 'code' ? 'code' : 'static'))
const requestBodyValue = computed(() => draft.value?.request?.value ?? '')

function switchRequestBodyMode(value: unknown): void {
  const mode: RequestBodyMode = value === 'code' ? 'code' : 'static'
  const config = draft.value?.request
  if (!config || requestBodyMode.value === mode) return
  requestBodyStash.value[requestBodyMode.value] = config.value ?? ''
  config.type = mode
  config.value = requestBodyStash.value[mode] || (mode === 'code' ? REQUEST_BODY_CODE_TEMPLATE : '')
}

function openEditor(rule?: BridgeRule, type?: RuleType): void {
  const next: BridgeRule = rule
    ? structuredClone(toRaw(rule))
    : {
        id: crypto.randomUUID(),
        name: '',
        enabled: true,
        type: type ?? 'redirect',
        source: { key: 'url', operator: 'contains', value: '' },
        updatedAt: new Date().toISOString(),
      }
  if (!rule) next.name = `${next.type}-${Date.now()}`
  ensureDefaults(next)
  draft.value = next
  isExistingDraft.value = !!rule
  ifCardCollapsed.value = false
  filterPanelOpen.value = countActiveFilters(next.filters) > 0
  editingName.value = false
  editingDescription.value = false
  redirectTargetType.value = 'url'
  requestBodyStash.value = { static: '', code: '' }
  view.value = 'editor'
}

function closeEditor(): void {
  view.value = 'list'
  draft.value = null
  editingName.value = false
  editingDescription.value = false
}

function switchDraftType(option: TypeOption): void {
  const current = draft.value
  if (!current || current.type === option.type) return
  current.type = option.type
  ensureDefaults(current)
}

function createRule(type: RuleType): void {
  pickerVisible.value = false
  openEditor(undefined, type)
}

function handleEditorHotkey(event: KeyboardEvent): void {
  if (view.value !== 'editor') return
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
  event.preventDefault()
  void save()
}

onMounted(() => window.addEventListener('keydown', handleEditorHotkey))
onUnmounted(() => window.removeEventListener('keydown', handleEditorHotkey))

watch(
  () => store.ruleEditorDraft,
  (rule) => {
    if (!rule) return
    openEditor(rule)
    store.ruleEditorDraft = null
  },
  // immediate：经路由切到规则页签时面板可能首次挂载，此时草稿已就位（流量一键建规则），
  // 非 immediate 的 watch 不会为初始值触发，编辑器将打不开
  { immediate: true },
)

function addHeaderOp(scope: 'request' | 'response'): void {
  const target = draft.value?.headers
  if (!target) return
  const ops = (target[scope] = target[scope] ?? [])
  ops.push({ id: crypto.randomUUID(), action: 'override', name: '', value: '' })
}

function removeHeaderOp(scope: 'request' | 'response', id: string): void {
  const ops = draft.value?.headers?.[scope]
  if (!ops) return
  const index = ops.findIndex(op => op.id === id)
  if (index >= 0) ops.splice(index, 1)
}

const queryParamRowLabels: Record<QueryParamAction, string> = { add: '添加', remove: '删除', removeAll: '清空全部' }

function emptyQueryMod(): QueryParamModification {
  return { id: crypto.randomUUID(), action: 'add', param: '', value: '', actionWhenParamExists: 'overwrite' }
}

function addQueryMod(): void {
  draft.value?.queryParam?.modifications.push(emptyQueryMod())
}

function setQueryModAction(mod: QueryParamModification, action: QueryParamAction): void {
  mod.action = action
}

function removeQueryMod(id: string): void {
  const config = draft.value?.queryParam
  if (!config) return
  const index = config.modifications.findIndex(mod => mod.id === id)
  if (index >= 0) config.modifications.splice(index, 1)
  if (!config.modifications.length) config.modifications.push(emptyQueryMod())
}

function applyUaPreset(value: string): void {
  if (draft.value?.userAgent) draft.value.userAgent.userAgent = value
}

function cleanOps(ops?: HeaderOperation[]): HeaderOperation[] | undefined {
  const cleaned = (ops ?? []).filter(op => op.name.trim())
  return cleaned.length ? cleaned : undefined
}

async function save(): Promise<void> {
  const current = draft.value
  if (!current) return
  const rule = structuredClone(toRaw(current))
  rule.name = rule.name.trim() || sourceSummary(rule)
  rule.description = rule.description?.trim() || undefined
  if (!rule.source.value.trim() && rule.type !== 'script') {
    ElMessage.warning('请填写匹配值')
    return
  }

  const filters = rule.filters
  const cleanedFilters: RuleFilters = {}
  if (filters?.requestMethod?.length) cleanedFilters.requestMethod = filters.requestMethod
  if (filters?.resourceType?.length) cleanedFilters.resourceType = filters.resourceType
  if (filters?.pageUrl?.trim()) cleanedFilters.pageUrl = filters.pageUrl.trim()
  if (filters?.requestPayload?.key.trim()) {
    cleanedFilters.requestPayload = {
      key: filters.requestPayload.key.trim(),
      operator: filters.requestPayload.operator,
      value: filters.requestPayload.value,
    }
  }
  rule.filters = Object.keys(cleanedFilters).length ? cleanedFilters : undefined

  const configKey: string | null = rule.type === 'cancel' ? null : rule.type
  for (const key of CONFIG_KEYS) {
    if (key !== configKey) rule[key] = undefined
  }

  switch (rule.type) {
    case 'redirect': {
      const destination = rule.redirect?.destination?.trim() ?? ''
      if (!destination) {
        ElMessage.warning('请填写重定向目标地址')
        return
      }
      if (!/^https?:\/\//i.test(destination) && !/\$[1-9]/.test(destination)) {
        ElMessage.warning('目标地址需以 http(s):// 开头（或用 $n 捕获组）')
        return
      }
      rule.redirect = {
        destination,
        statusCode: rule.redirect?.statusCode ?? 302,
        preserveQueryParams: rule.redirect?.preserveQueryParams || undefined,
      }
      break
    }
    case 'replace': {
      const from = rule.replace?.from ?? ''
      if (!from) {
        ElMessage.warning('请填写要替换的原片段')
        return
      }
      rule.replace = { from, to: rule.replace?.to ?? '' }
      break
    }
    case 'queryParam': {
      const modifications = (rule.queryParam?.modifications ?? []).filter(mod => mod.action === 'removeAll' || mod.param.trim())
      if (!modifications.length) {
        ElMessage.warning('请至少添加一个参数修改项')
        return
      }
      rule.queryParam = { modifications }
      break
    }
    case 'delay': {
      const delayMs = Math.min(Math.max(Math.trunc(rule.delay?.delayMs ?? 0), 1), RULE_DELAY_MAX_MS)
      rule.delay = { delayMs }
      break
    }
    case 'headers': {
      const request = cleanOps(rule.headers?.request)
      const response = cleanOps(rule.headers?.response)
      if (!request && !response) {
        ElMessage.warning('请至少添加一个头操作')
        return
      }
      rule.headers = { request, response }
      break
    }
    case 'userAgent': {
      const userAgent = rule.userAgent?.userAgent?.trim() ?? ''
      if (!userAgent) {
        ElMessage.warning('请填写 User-Agent')
        return
      }
      rule.userAgent = { userAgent }
      break
    }
    case 'request': {
      const mode: RequestBodyMode = rule.request?.type === 'code' ? 'code' : 'static'
      const value = rule.request?.value ?? ''
      if (mode === 'code') {
        if (!value.trim()) {
          ElMessage.warning('请填写动态脚本')
          return
        }
      } else if (!value.length) {
        ElMessage.warning('请填写替换后的请求体')
        return
      }
      rule.request = { type: mode, value }
      break
    }
    case 'response': {
      const statusCode = rule.response?.statusCode && Number.isFinite(rule.response.statusCode) ? rule.response.statusCode : undefined
      const statusText = rule.response?.statusText?.trim() || undefined
      const bodyReplace = rule.response?.bodyReplace?.length ? rule.response.bodyReplace : undefined
      const mock = rule.response?.mock || undefined
      if (!statusCode && !statusText && bodyReplace === undefined && !mock) {
        ElMessage.warning('请至少设置状态码 / 状态文案 / 响应体 / Mock 之一')
        return
      }
      rule.response = { statusCode, statusText, bodyReplace, mock }
      break
    }
    case 'script': {
      const code = rule.script?.code ?? ''
      if (!code.trim()) {
        ElMessage.warning('请填写脚本正文')
        return
      }
      rule.source.value = rule.source.value.trim()
      rule.filters = undefined
      rule.script = {
        code,
        world: rule.script?.world ?? 'MAIN',
        runAt: rule.script?.runAt ?? 'document_start',
      }
      break
    }
    case 'cancel':
      break
  }

  rule.updatedAt = new Date().toISOString()
  await store.upsertRule(rule)
  closeEditor()
  ElMessage.success('规则已保存')
}

async function toggleEnabled(rule: BridgeRule): Promise<void> {
  rule.enabled = !rule.enabled
  await store.upsertRule({ ...rule, updatedAt: new Date().toISOString() })
}

async function remove(rule: BridgeRule): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除规则「${rule.name}」？`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  await store.deleteRule(rule.id)
  selectedIds.value.delete(rule.id)
}
</script>

<template>
  <div v-if="view === 'list'" class="content-list-screen">
    <div class="content-list-screen-body">
      <ol class="rq-breadcrumb">
        <li>
          <button type="button" class="crumb" @click="resetToList">
            规则
          </button>
        </li>
        <li aria-hidden="true">
          <svg class="crumb-sep" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4.5 2.5L8 6l-3.5 3.5" />
          </svg>
        </li>
        <li>
          <span class="crumb current">{{ activeType ? RULE_TYPE_LABELS[activeType] : activeFilterLabel }}</span>
        </li>
      </ol>

      <div class="rq-content-list-header">
        <div class="rq-content-list-header-filters">
          <el-input v-model="searchValue" class="rq-content-list-header-search-input" placeholder="搜索" clearable>
            <template #prefix>
              <svg class="search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                <circle cx="9" cy="9" r="5.5" />
                <path d="M13.2 13.2L17 17" />
              </svg>
            </template>
          </el-input>
          <div class="filter-btns">
            <button
              v-for="option in filterOptions"
              :key="option.key"
              type="button"
              class="filter-btn"
              :class="{ active: activeFilter === option.key }"
              @click="activeFilter = option.key"
            >
              <span class="label">
                <svg v-if="option.icon === 'pin'" class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M7.5 3.5h5" />
                  <path d="M8.7 3.5 8 8 6 10v1.5h8V10l-2-2-.7-4.5" />
                  <path d="M10 11.5V16.5" />
                </svg>
                <svg v-else-if="option.icon === 'toggle'" class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="2" y="6.5" width="16" height="7" rx="3.5" />
                  <circle cx="13.5" cy="10" r="2" fill="currentColor" stroke="none" />
                </svg>
                {{ option.label }}
                <span v-if="filterCounts[option.key]" class="filter-badge mono">{{ filterCounts[option.key] }}</span>
              </span>
            </button>
          </div>
          <el-select
            :model-value="activeType"
            class="rule-type-filter"
            style="width: 170px"
            @change="selectRuleType"
          >
            <el-option v-for="option in ruleTypeFilterOptions" :key="option.label" :label="option.label" :value="option.value" />
          </el-select>
        </div>
        <div class="rq-content-list-header-actions">
          <el-popover
            v-model:visible="pickerVisible"
            trigger="click"
            placement="bottom-end"
            :width="400"
            :offset="0"
            popper-class="rule-picker-popover"
          >
            <template #reference>
              <el-button type="primary">
                <svg class="btn-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                  <path d="M10 4v12M4 10h12" />
                </svg>
                新建规则
              </el-button>
            </template>
            <div class="rule-picker-list">
              <div v-for="group in typeGroups" :key="group.title" class="rule-picker-section">
                <div class="rule-picker-category">
                  <span class="title">{{ group.title }}</span>
                  <span class="divider" />
                </div>
                <button
                  v-for="option in group.options"
                  :key="option.type"
                  type="button"
                  class="rule-picker-item"
                  @click="chooseTypeOption(option)"
                >
                  <svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path v-for="(d, index) in option.icon" :key="index" :d="d" />
                  </svg>
                  <span class="details">
                    <span class="title">{{ option.title }}</span>
                    <span class="desc">{{ option.desc }}</span>
                  </span>
                </button>
              </div>
            </div>
          </el-popover>
        </div>
      </div>

      <div class="rq-rules-table">
        <div class="rq-content-list-table-container">
          <table class="rq-content-list-table">
            <colgroup>
              <col class="col-select">
              <col class="col-pin">
              <col class="col-name">
              <col class="col-type">
              <col class="col-status">
              <col class="col-updated">
              <col class="col-actions">
            </colgroup>
            <thead class="rq-content-list-table-header">
              <tr>
                <th class="cell-select">
                  <el-checkbox
                    :model-value="allVisibleSelected"
                    :indeterminate="someVisibleSelected && !allVisibleSelected"
                    :disabled="!visibleRules.length"
                    @change="toggleSelectAll"
                  />
                </th>
                <th class="cell-pin" />
                <th class="sortable" @click="cycleSort('name')">
                  <span class="th-label">
                    规则
                    <svg class="sorter" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
                      <path :class="{ active: sortState('name') === 'asc' }" d="M5 1l3 4H2z" />
                      <path :class="{ active: sortState('name') === 'desc' }" d="M5 13l-3-4h6z" />
                    </svg>
                  </span>
                </th>
                <th class="sortable" @click="cycleSort('type')">
                  <span class="th-label">
                    类型
                    <svg class="sorter" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
                      <path :class="{ active: sortState('type') === 'asc' }" d="M5 1l3 4H2z" />
                      <path :class="{ active: sortState('type') === 'desc' }" d="M5 13l-3-4h6z" />
                    </svg>
                  </span>
                </th>
                <th>状态</th>
                <th class="sortable" @click="cycleSort('updated')">
                  <span class="th-label">
                    更新时间
                    <svg class="sorter" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
                      <path :class="{ active: sortState('updated') === 'asc' }" d="M5 1l3 4H2z" />
                      <path :class="{ active: sortState('updated') === 'desc' }" d="M5 13l-3-4h6z" />
                    </svg>
                  </span>
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="rule in visibleRules"
                :key="rule.id"
                class="rq-content-list-table-row"
                :class="{ 'record-pinned': rule.pinned, 'selected': isSelected(rule) }"
              >
                <td class="cell-select">
                  <el-checkbox :model-value="isSelected(rule)" @change="toggleSelect(rule)" />
                </td>
                <td class="cell-pin">
                  <button
                    type="button"
                    class="icon-btn pin-record-btn"
                    :title="rule.pinned ? '取消固定' : '固定到列表'"
                    @click="togglePin(rule)"
                  >
                    <svg
                      :class="rule.pinned ? 'record-pinned' : 'record-unpinned'"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M7.5 3.5h5" />
                      <path d="M8.7 3.5 8 8 6 10v1.5h8V10l-2-2-.7-4.5" />
                      <path d="M10 11.5V16.5" />
                    </svg>
                  </button>
                </td>
                <td class="cell-name">
                  <button type="button" class="rule-name" :title="rule.name" @click="openEditor(rule)">
                    {{ rule.name }}
                  </button>
                </td>
                <td>
                  <span class="rule-type-tag" :title="RULE_TYPE_LABELS[rule.type]">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                      <path v-for="(d, index) in typeIcons[rule.type]" :key="index" :d="d" />
                    </svg>
                    <span class="rule-type-tag-name">{{ RULE_TYPE_LABELS[rule.type] }}</span>
                  </span>
                </td>
                <td>
                  <el-switch :model-value="rule.enabled" size="small" @change="toggleEnabled(rule)" />
                </td>
                <td>
                  <span class="rule-updated-on">{{ formatDate(rule.updatedAt) }}</span>
                </td>
                <td>
                  <div class="rules-actions-container">
                    <el-dropdown trigger="click" popper-class="rule-more-actions-dropdown" @command="(command: string) => handleRuleAction(command, rule)">
                      <button type="button" class="icon-btn more-rule-actions-btn" aria-label="更多操作">
                        <svg viewBox="0 0 20 20" fill="currentColor">
                          <circle cx="5" cy="10" r="1.4" />
                          <circle cx="10" cy="10" r="1.4" />
                          <circle cx="15" cy="10" r="1.4" />
                        </svg>
                      </button>
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item command="duplicate">
                            <svg class="menu-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                              <rect x="7" y="7" width="9" height="9" rx="1.5" />
                              <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
                            </svg>
                            <span>复制</span>
                          </el-dropdown-item>
                          <el-dropdown-item command="delete" class="danger-item">
                            <svg class="menu-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M4 6h12" />
                              <path d="M8 6V4.5h4V6" />
                              <path d="M5.8 6l.7 10.5h7l.7-10.5" />
                              <path d="M8.5 9v5M11.5 9v5" />
                            </svg>
                            <span>删除</span>
                          </el-dropdown-item>
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </div>
                </td>
              </tr>
              <tr v-if="!visibleRules.length" class="empty-row">
                <td colspan="7" class="empty-cell">
                  <el-empty description="暂无规则" :image-size="72" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-if="view === 'list' && selectedRules.length" class="rq-bulk-action-bar-container">
      <div class="rq-bulk-action-bar-info-text">
        已选 {{ selectedRules.length }} 条规则
      </div>
      <div class="rq-bulk-action-bar-action-btn-container">
        <el-button @click="bulkToggleEnabled">
          {{ bulkAllEnabled ? '停用' : '启用' }}
        </el-button>
        <el-button class="bulk-danger-btn" @click="bulkDelete">
          删除
        </el-button>
        <el-button text @click="clearSelection">
          <svg class="btn-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
          取消
        </el-button>
      </div>
    </div>
  </div>

  <div v-else-if="draft" class="rule-editor-screen">
    <aside class="rule-editor-sidebar">
      <div v-for="group in typeGroups" :key="group.title" class="rule-editor-sidebar-group">
        <div class="sidebar-category">
          {{ group.title }}
        </div>
        <button
          v-for="option in group.options"
          :key="option.type"
          type="button"
          class="sidebar-item"
          :class="{ active: option.type === draft.type }"
          @click="switchDraftType(option)"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path v-for="(d, index) in option.icon" :key="index" :d="d" />
          </svg>
          <span>{{ option.title }}</span>
        </button>
      </div>
    </aside>

    <div class="rule-editor-main">
      <div class="rule-editor-topbar">
        <div class="topbar-left">
          <button type="button" class="icon-btn topbar-back-btn" title="返回列表" @click="closeEditor">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11.5 5 6.5 10l5 5" />
              <path d="M6.5 10h9" />
            </svg>
          </button>
          <nav class="editor-breadcrumb">
            <button type="button" class="crumb" @click="closeEditor">
              规则
            </button>
            <span class="crumb-sep-text">›</span>
            <span class="crumb-current">{{ isExistingDraft ? '编辑规则' : '创建规则' }}</span>
          </nav>
        </div>
        <div class="topbar-right">
          <span class="muted enable-label">启用</span>
          <el-switch v-model="draft.enabled" size="small" />
          <el-button type="primary" @click="save">
            保存规则
            <span class="kbd-hint">Ctrl S</span>
          </el-button>
        </div>
      </div>

      <div class="rule-editor-body">
        <div class="rule-title-row">
          <el-input
            v-if="editingName"
            v-model="draft.name"
            class="rule-title-input"
            @blur="editingName = false"
            @keydown.enter="editingName = false"
          />
          <button v-else type="button" class="rule-title" title="点击重命名" @click="editingName = true">
            {{ draft.name || '未命名规则' }}
            <svg class="pencil-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12.9 4.2 2.9 2.9-8.1 8.1-3.5.6.6-3.5z" />
              <path d="m11.6 5.5 2.9 2.9" />
            </svg>
          </button>
        </div>
        <div class="rule-description-row">
          <el-input
            v-if="editingDescription"
            v-model="draft.description"
            placeholder="添加描述（可选）"
            @blur="editingDescription = false"
            @keydown.enter="editingDescription = false"
          />
          <button v-else type="button" class="rule-description" :class="{ placeholder: !draft.description }" @click="editingDescription = true">
            {{ draft.description || '添加描述（可选）' }}
          </button>
        </div>

        <div v-if="draft.type === 'request'" class="resource-types-card">
          <div class="resource-types-header">
            <span class="panel-header">选择资源类型</span>
          </div>
          <div class="resource-types-body">
            <div class="resource-types-panel">
              <el-radio-group model-value="rest" class="dest-radio-group">
                <el-radio value="rest">
                  REST API
                </el-radio>
                <el-radio value="graphql" disabled>
                  GraphQL API
                </el-radio>
              </el-radio-group>
            </div>
            <p class="form-hint dest-hint">
              GraphQL 请求体改写暂未支持，当前按 REST API 处理。
            </p>
          </div>
        </div>

        <div class="rule-pair-card">
          <button type="button" class="rule-pair-header" @click="ifCardCollapsed = !ifCardCollapsed">
            <span class="panel-header">{{ ifCardLabel }}</span>
            <svg class="chevron" :class="{ rotated: ifCardCollapsed }" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5.5 12.5 10 8l4.5 4.5" />
            </svg>
          </button>

          <div v-show="!ifCardCollapsed" class="rule-pair-body">
            <div class="source-row">
              <el-select v-model="draft.source.key" style="width: 104px">
                <el-option v-for="option in keyOptions" :key="option.value" :label="option.label" :value="option.value" />
              </el-select>
              <el-select v-model="draft.source.operator" style="width: 168px">
                <el-option v-for="option in operatorOptions" :key="option.value" :label="option.label" :value="option.value" />
              </el-select>
              <el-input
                v-model="draft.source.value"
                :placeholder="draft.type === 'script' ? '留空 = 应用于所有页面（例如 example.com/checkout）' : '例如 example.com/api'"
                class="source-value-input"
              />
              <button
                v-if="draft.type !== 'script'"
                type="button"
                class="filters-toggle"
                :class="{ active: countActiveFilters(draft.filters) > 0 }"
                @click="filterPanelOpen = !filterPanelOpen"
              >
                高级过滤
                <span v-if="countActiveFilters(draft.filters)" class="filter-count mono">{{ countActiveFilters(draft.filters) }}</span>
              </button>
            </div>

            <div v-if="draft.type !== 'script'" v-show="filterPanelOpen" class="filter-block">
              <div class="inline-group wrap">
                <el-select v-model="draft.filters!.requestMethod" multiple collapse-tags clearable placeholder="方法（不限留空）" style="width: 220px">
                  <el-option v-for="method in REQUEST_METHODS" :key="method" :label="method" :value="method" />
                </el-select>
                <el-select v-model="draft.filters!.resourceType" multiple collapse-tags clearable placeholder="资源类型（不限留空）" style="width: 220px">
                  <el-option v-for="(label, value) in RESOURCE_TYPE_LABELS" :key="value" :label="label" :value="value" />
                </el-select>
                <el-input v-model="draft.filters!.pageUrl" placeholder="页面 URL 包含…（如 example.com/checkout）" style="width: 280px" />
              </div>
              <div class="inline-group wrap payload-row">
                <el-checkbox v-model="payloadEnabled">
                  请求体过滤
                </el-checkbox>
                <template v-if="draft.filters?.requestPayload">
                  <el-input v-model="draft.filters.requestPayload.key" placeholder="键（JSON 顶层 / GraphQL 变量 / 表单参数）" style="width: 300px" />
                  <el-select v-model="draft.filters.requestPayload.operator" style="width: 110px">
                    <el-option label="等于" value="equals" />
                    <el-option label="包含" value="contains" />
                  </el-select>
                  <el-input v-model="draft.filters.requestPayload.value" placeholder="值" style="width: 200px" />
                </template>
                <span class="form-hint">命中请求体过滤的规则会先缓冲请求体（超大请求体会被拒）</span>
              </div>
            </div>

            <div class="then-section">
              <div class="then-label">
                <span>{{ thenSectionLabel }}</span>
                <el-radio-group
                  v-if="draft.type === 'request' && draft.request"
                  class="request-body-mode-group"
                  :model-value="requestBodyMode"
                  @change="switchRequestBodyMode"
                >
                  <el-radio value="static">
                    静态数据
                    <el-tooltip content="填写要随请求发送的静态 JSON 请求体" placement="top">
                      <span class="info-icon-wrap">
                        <svg class="info-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                          <circle cx="10" cy="10" r="7.5" />
                          <path d="M10 9v4.5" />
                          <path d="M10 6.5v.01" />
                        </svg>
                      </span>
                    </el-tooltip>
                  </el-radio>
                  <el-radio value="code">
                    动态（JavaScript）
                    <el-tooltip content="编写 JavaScript 代码改写现有请求体" placement="top">
                      <span class="info-icon-wrap">
                        <svg class="info-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                          <circle cx="10" cy="10" r="7.5" />
                          <path d="M10 9v4.5" />
                          <path d="M10 6.5v.01" />
                        </svg>
                      </span>
                    </el-tooltip>
                  </el-radio>
                </el-radio-group>
                <el-tooltip v-if="draft.type === 'redirect'" content="定义要将原始请求重定向到的目标地址" placement="top">
                  <span class="info-icon-wrap">
                    <svg class="info-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                      <circle cx="10" cy="10" r="7.5" />
                      <path d="M10 9v4.5" />
                      <path d="M10 6.5v.01" />
                    </svg>
                  </span>
                </el-tooltip>
              </div>

              <template v-if="draft.type === 'redirect' && draft.redirect">
                <div class="dest-panel">
                  <el-radio-group v-model="redirectTargetType" class="dest-radio-group">
                    <el-radio value="url">
                      另一个 URL
                    </el-radio>
                    <el-radio value="local" disabled>
                      本机文件
                    </el-radio>
                    <el-radio value="fileserver" disabled>
                      文件服务器
                    </el-radio>
                  </el-radio-group>
                  <p class="form-hint dest-hint">
                    「本机文件 / 文件服务器」后续版本支持，当前仅支持重定向到 URL。
                  </p>
                  <el-input v-model="draft.redirect.destination" placeholder="例如 https://new-example.com（支持 $1 捕获组）" class="dest-input" />
                  <div class="inline-group wrap dest-advanced">
                    <el-select v-model="draft.redirect.statusCode" style="width: 190px">
                      <el-option :value="302" label="302 临时" />
                      <el-option :value="301" label="301 永久" />
                      <el-option :value="307" label="307 保留方法" />
                      <el-option :value="308" label="308 永久 + 保留方法" />
                    </el-select>
                    <el-checkbox v-model="draft.redirect.preserveQueryParams">
                      目标未带查询串时保留原查询参数
                    </el-checkbox>
                  </div>
                  <p class="form-hint">
                    源用「正则匹配 / 通配符」时，目标里的 $1、$2 会替换为捕获内容（通配符 * 也可用 $1 取到）。
                  </p>
                </div>
              </template>

              <template v-else-if="draft.type === 'replace' && draft.replace">
                <div class="inline-group wrap">
                  <el-input v-model="draft.replace.from" placeholder="原片段（在完整 URL 中把…）" style="flex: 1; min-width: 260px" />
                  <span class="muted">→</span>
                  <el-input v-model="draft.replace.to" placeholder="替换为" style="flex: 1; min-width: 260px" />
                </div>
                <p class="form-hint">
                  只替换 URL 中第一处匹配；替换后的 URL 直接作为新请求目标（浏览器不可见，比重定向更透明）。
                </p>
              </template>

              <template v-else-if="draft.type === 'queryParam' && draft.queryParam">
                <div v-for="mod in draft.queryParam.modifications" :key="mod.id" class="param-mod-row">
                  <el-dropdown trigger="click" popper-class="rule-more-actions-dropdown" @command="(action: QueryParamAction) => setQueryModAction(mod, action)">
                    <button type="button" class="param-mod-type">
                      {{ queryParamRowLabels[mod.action] }}
                      <svg class="param-mod-caret" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                        <path d="m6 8 4 4 4-4" />
                      </svg>
                    </button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="add">
                          添加 / 替换
                        </el-dropdown-item>
                        <el-dropdown-item command="remove">
                          删除
                        </el-dropdown-item>
                        <el-dropdown-item command="removeAll">
                          清空全部
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                  <el-input v-model="mod.param" :disabled="mod.action === 'removeAll'" class="param-mod-name" placeholder="参数名">
                    <template #prepend>
                      参数
                    </template>
                  </el-input>
                  <el-input v-model="mod.value" :disabled="mod.action !== 'add'" class="param-mod-value" placeholder="参数值">
                    <template #prepend>
                      值
                    </template>
                  </el-input>
                  <el-tooltip content="移除" placement="top">
                    <button type="button" class="param-mod-remove" @click="removeQueryMod(mod.id)">
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                        <path d="M15 5 5 15" />
                        <path d="m5 5 10 10" />
                      </svg>
                    </button>
                  </el-tooltip>
                </div>
                <button type="button" class="param-mod-add" @click="addQueryMod">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                    <path d="M10 4v12M4 10h12" />
                  </svg>
                  添加参数修改
                </button>
              </template>

              <template v-else-if="draft.type === 'cancel'">
                <p class="form-hint no-margin">
                  命中后直接断开连接，浏览器表现为请求失败（类似网络异常，页面无法拿到 4xx 状态）。
                </p>
              </template>

              <template v-else-if="draft.type === 'delay' && draft.delay">
                <div class="inline-group wrap">
                  <el-input-number v-model="draft.delay.delayMs" :min="1" :max="RULE_DELAY_MAX_MS" :step="500" />
                  <span class="muted">毫秒（上限 {{ RULE_DELAY_MAX_MS / 1000 }}s），延迟后照常请求上游</span>
                </div>
              </template>

              <template v-else-if="draft.type === 'headers' && draft.headers">
                <div class="muted op-section-title">
                  请求头操作
                </div>
                <div v-for="op in draft.headers.request ?? []" :key="op.id" class="inline-group wrap op-row">
                  <el-select v-model="op.action" style="width: 130px">
                    <el-option v-for="option in headerActionOptions" :key="option.value" :label="option.label" :value="option.value" />
                  </el-select>
                  <el-input v-model="op.name" placeholder="头名称" style="width: 220px" />
                  <el-input v-model="op.value" :disabled="op.action === 'remove'" placeholder="值" style="flex: 1; min-width: 180px" />
                  <el-button text type="danger" @click="removeHeaderOp('request', op.id)">
                    移除
                  </el-button>
                </div>
                <el-button size="small" text type="primary" @click="addHeaderOp('request')">
                  + 请求头操作
                </el-button>
                <div class="muted op-section-title">
                  响应头操作
                </div>
                <div v-for="op in draft.headers.response ?? []" :key="op.id" class="inline-group wrap op-row">
                  <el-select v-model="op.action" style="width: 130px">
                    <el-option v-for="option in headerActionOptions" :key="option.value" :label="option.label" :value="option.value" />
                  </el-select>
                  <el-input v-model="op.name" placeholder="头名称" style="width: 220px" />
                  <el-input v-model="op.value" :disabled="op.action === 'remove'" placeholder="值" style="flex: 1; min-width: 180px" />
                  <el-button text type="danger" @click="removeHeaderOp('response', op.id)">
                    移除
                  </el-button>
                </div>
                <el-button size="small" text type="primary" @click="addHeaderOp('response')">
                  + 响应头操作
                </el-button>
              </template>

              <template v-else-if="draft.type === 'userAgent' && draft.userAgent">
                <div class="inline-group wrap">
                  <el-input v-model="draft.userAgent.userAgent" placeholder="自定义 UA 字符串" style="flex: 1; min-width: 320px" />
                  <el-select placeholder="常用预设" style="width: 180px" @change="applyUaPreset">
                    <el-option v-for="preset in uaPresets" :key="preset.label" :label="preset.label" :value="preset.value" />
                  </el-select>
                </div>
              </template>

              <template v-else-if="draft.type === 'request' && draft.request">
                <el-input
                  v-model="draft.request.value"
                  type="textarea"
                  :rows="requestBodyMode === 'code' ? 12 : 8"
                  :placeholder="requestBodyMode === 'code' ? 'async function modifyRequestBody(args) { … }' : '填写要发送的静态 JSON 请求体'"
                  class="body-input code-input"
                />
                <div class="code-meta">
                  <span class="muted mono">{{ requestBodyValue.length }} 字符</span>
                </div>
                <p class="form-hint">
                  静态 → 整体替换请求体；动态 → edt 代理侧沙箱执行 modifyRequestBody(args)，入参 { method, url, body, bodyAsJson }，返回新请求体（支持 async；1 秒超时、出错保留原体）。仅对文本类请求体（JSON / 表单等）生效；超过 8MB 的请求体会直接拒绝（502）。
                </p>
              </template>

              <template v-else-if="draft.type === 'response' && draft.response">
                <div class="inline-group wrap">
                  <span class="muted">状态码</span>
                  <el-input-number v-model="draft.response.statusCode" :min="100" :max="599" :controls="false" placeholder="原始" style="width: 110px" />
                  <el-input v-model="draft.response.statusText" placeholder="状态文案（如 Teapot）" style="width: 220px" />
                  <el-checkbox v-model="draft.response.mock">
                    Mock（不调服务器直接返回）
                  </el-checkbox>
                </div>
                <el-input
                  v-model="draft.response.bodyReplace"
                  type="textarea"
                  :rows="5"
                  placeholder="静态替换响应体 / Mock 返回体（留空 = 不改体；Mock 时返回空体）"
                  class="body-input"
                />
              </template>

              <template v-else-if="draft.type === 'script' && draft.script">
                <div class="inline-group wrap">
                  <el-select v-model="draft.script.world" style="width: 300px">
                    <el-option v-for="option in worldOptions" :key="option.value" :label="option.label" :value="option.value" />
                  </el-select>
                  <el-select v-model="draft.script.runAt" style="width: 250px">
                    <el-option v-for="option in runAtOptions" :key="option.value" :label="option.label" :value="option.value" />
                  </el-select>
                </div>
                <el-input
                  v-model="draft.script.code"
                  type="textarea"
                  :rows="12"
                  placeholder="// 脚本正文（JS），在匹配页面注入执行"
                  class="body-input code-input"
                />
                <div class="code-meta">
                  <span class="muted mono">{{ draft.script.code.length }} 字符</span>
                </div>
                <p class="form-hint">
                  脚本存 edt，经桥同步给扩展后用 chrome.userScripts 注册；改动对已打开的页面在下次导航生效。MAIN 世界无扩展 API；ISOLATED 世界可将结果经 window.postMessage 互动。
                </p>
              </template>
            </div>
          </div>
        </div>

        <el-tooltip content="暂不支持多条件（单规则单动作）" placement="top">
          <span class="add-condition-wrap">
            <button type="button" class="add-condition-btn" disabled>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                <path d="M10 4v12M4 10h12" />
              </svg>
              添加新条件
            </button>
          </span>
        </el-tooltip>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── 列表屏（对齐 Requestly content-list 布局，浅色 + 语义令牌） ── */

.content-list-screen {
  width: 100%;
}

.content-list-screen-body {
  width: 100%;
}

.rq-breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 4px;
  padding: 0;
  margin: 0 0 8px;
  list-style: none;
  max-height: 24px;
}

.rq-breadcrumb .crumb {
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: none;
  font-family: inherit;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-regular);
  line-height: var(--font-size-base);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.rq-breadcrumb .crumb:hover {
  text-decoration: underline;
}

.rq-breadcrumb .crumb.current {
  color: var(--color-text-primary);
  cursor: default;
}

.rq-breadcrumb .crumb.current:hover {
  text-decoration: none;
}

.rq-breadcrumb .crumb-sep {
  width: 12px;
  height: 12px;
  display: block;
  color: var(--color-text-secondary);
}

.rq-content-list-header {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 0;
}

.rq-content-list-header-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.rq-content-list-header-search-input {
  width: 224px;
}

.rq-content-list-header-search-input :deep(.el-input__wrapper) {
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-xs);
}

.rq-content-list-header-search-input :deep(.el-input__inner) {
  font-size: var(--font-size-sm);
}

.search-icon {
  width: 16px;
  height: 16px;
  color: var(--color-text-secondary);
}

.filter-btns {
  display: flex;
  gap: 4px;
}

.filter-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 70px;
  height: 32px;
  padding: 4px 8px;
  border: none;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: var(--font-size-sm);
  line-height: 20px;
  letter-spacing: 0.25px;
  cursor: pointer;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}

.filter-btn:hover {
  background: var(--color-surface);
}

.filter-btn.active {
  background: var(--color-surface);
  color: var(--color-text-primary);
}

.filter-btn .label {
  display: inline-flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
}

.filter-btn .label .icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: inherit;
}

.filter-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--color-border-light);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 20px;
}

.rq-content-list-header-actions {
  display: flex;
  gap: 8px;
}

.rq-content-list-header-actions :deep(.el-button) {
  border-radius: var(--radius-xs);
}

.btn-icon {
  width: 14px;
  height: 14px;
  margin-right: 6px;
}

.rq-rules-table {
  display: block;
}

.rq-content-list-table-container {
  width: 100%;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xs);
  background: var(--color-surface);
  overflow-x: auto;
}

.rq-content-list-table {
  width: 100%;
  min-width: 860px;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: var(--font-size-sm);
}

.col-select {
  width: 46px;
}

.col-pin {
  width: 72px;
}

.col-type {
  width: 200px;
}

.col-status {
  width: 130px;
}

.col-updated {
  width: 150px;
}

.col-actions {
  width: 110px;
}

.rq-content-list-table-header th {
  padding: 12px;
  background: var(--color-muted);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-regular);
  line-height: 20px;
  letter-spacing: 0.25px;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--color-border-light);
  user-select: none;
}

.rq-content-list-table-header th.sortable {
  cursor: pointer;
}

.th-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.sorter {
  width: 10px;
  height: 12px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.sorter .active {
  color: var(--color-primary);
}

.rq-content-list-table-row {
  background: var(--color-surface);
  transition: background-color var(--transition-fast);
}

.rq-content-list-table-row:hover {
  background: var(--color-muted);
}

.rq-content-list-table-row.selected,
.rq-content-list-table-row.selected:hover {
  background: var(--color-primary-soft);
}

.rq-content-list-table-row > td {
  padding: 12px;
  color: var(--color-text-primary);
  border-bottom: 1px solid var(--color-border-light);
  vertical-align: middle;
}

.rq-content-list-table-row > td.cell-select {
  border-left: 4px solid transparent;
}

.rq-content-list-table-row.record-pinned > td.cell-select {
  border-left-color: var(--color-warning);
}

.cell-pin {
  text-align: center;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: var(--radius-xs);
  background: none;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: color var(--transition-fast), background-color var(--transition-fast);
}

.icon-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-border-light);
}

.icon-btn svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.pin-record-btn svg.record-pinned,
.pin-record-btn:hover svg.record-pinned {
  color: var(--color-warning);
}

.cell-name {
  overflow: hidden;
}

.rule-name {
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-primary);
  font-family: inherit;
  font-size: var(--font-size-sm);
  line-height: 20px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--transition-fast);
}

.rule-name:hover {
  color: var(--color-primary-hover);
}

.rule-type-tag {
  display: inline-flex;
  align-items: center;
  column-gap: 6px;
  flex-wrap: nowrap;
  color: var(--color-text-secondary);
}

.rule-type-tag svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: inherit;
}

.rule-type-tag-name {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-updated-on {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--font-size-sm);
  line-height: 20px;
}

.rules-actions-container {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.empty-cell {
  padding: 40px 0 !important;
  border-bottom: none !important;
}

/* ── 批量操作栏（Requestly bulk action bar 布局） ── */

.rq-bulk-action-bar-container {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 8px;
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: 10;
  width: max-content;
  padding: 12px 16px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xs);
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}

.rq-bulk-action-bar-info-text {
  flex-shrink: 0;
  min-width: 110px;
  margin-right: auto;
  color: var(--color-text-secondary);
  text-align: center;
  font-size: var(--font-size-sm);
  line-height: 20px;
  letter-spacing: 0.25px;
}

.rq-bulk-action-bar-action-btn-container {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.rq-bulk-action-bar-action-btn-container :deep(.el-button) {
  border-radius: var(--radius-xs);
  border-color: var(--color-border-light);
  background: var(--color-muted);
  color: var(--color-text-primary);
}

.rq-bulk-action-bar-action-btn-container :deep(.el-button:hover) {
  border-color: var(--color-border);
  background: var(--color-border-light);
  color: var(--color-text-primary);
}

.rq-bulk-action-bar-action-btn-container :deep(.el-button.bulk-danger-btn) {
  --el-button-bg-color: var(--color-error);
  --el-button-border-color: var(--color-error);
  --el-button-text-color: var(--color-surface);
  --el-button-hover-bg-color: color-mix(in srgb, var(--color-error) 85%, var(--color-surface));
  --el-button-hover-border-color: color-mix(in srgb, var(--color-error) 85%, var(--color-surface));
  --el-button-hover-text-color: var(--color-surface);
}

.rq-bulk-action-bar-action-btn-container :deep(.el-button.is-text) {
  background: none;
  border-color: transparent;
}

/* ── 规则编辑器（整页视图，对齐 Requestly rule editor） ── */

.rule-editor-screen {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-lg);
  width: 100%;
}

.rule-editor-sidebar {
  position: sticky;
  top: 0;
  flex: 0 0 212px;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  padding: var(--spacing-sm) 0;
}

.rule-editor-sidebar-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-category {
  padding: 0 var(--spacing-sm) var(--spacing-xs);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-tertiary);
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  width: 100%;
  padding: 8px var(--spacing-sm);
  border: 0;
  border-radius: var(--radius-xs);
  background: none;
  font-family: inherit;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.sidebar-item svg {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  color: var(--color-text-secondary);
}

.sidebar-item:hover {
  background: var(--color-muted);
}

.sidebar-item.active {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.sidebar-item.active svg {
  color: var(--color-primary);
}

.rule-editor-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.rule-editor-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding-bottom: var(--spacing-md);
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-shrink: 0;
}

.enable-label {
  font-size: var(--font-size-sm);
}

.editor-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

.editor-breadcrumb .crumb {
  padding: 0;
  border: 0;
  background: none;
  font-family: inherit;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.editor-breadcrumb .crumb:hover {
  color: var(--color-primary);
}

.crumb-sep-text {
  color: var(--color-text-tertiary);
}

.crumb-current {
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.kbd-hint {
  margin-left: var(--spacing-sm);
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--color-surface) 45%, transparent);
  border-radius: var(--radius-xs);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 14px;
  opacity: 0.9;
}

.rule-editor-body {
  padding: var(--spacing-xl) 0 var(--spacing-2xl);
}

.rule-title-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-xs);
}

.rule-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: none;
  font-family: inherit;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
}

.rule-title .pencil-icon {
  width: 14px;
  height: 14px;
  color: var(--color-text-tertiary);
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.rule-title:hover .pencil-icon {
  opacity: 1;
}

.rule-title-input {
  max-width: 480px;
}

.rule-title-input :deep(.el-input__inner) {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
}

.rule-description-row {
  margin-bottom: var(--spacing-lg);
}

.rule-description {
  padding: 0;
  border: 0;
  background: none;
  font-family: inherit;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  text-align: left;
  cursor: pointer;
  transition: color var(--transition-fast);
}

.rule-description.placeholder {
  color: var(--color-text-tertiary);
}

.rule-description:hover {
  color: var(--color-primary);
}

.rule-pair-card {
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
}

.rule-pair-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 14px var(--spacing-xl);
  border: 0;
  background: none;
  font-family: inherit;
  color: var(--color-text-primary);
  cursor: pointer;
}

.panel-header {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.chevron {
  width: 14px;
  height: 14px;
  color: var(--color-text-secondary);
  transition: transform var(--transition-fast);
}

.chevron.rotated {
  transform: rotate(180deg);
}

.rule-pair-body {
  padding: var(--spacing-lg) var(--spacing-xl) var(--spacing-xl);
  border-top: 1px solid var(--color-border-light);
}

.source-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.source-value-input {
  flex: 1;
  min-width: 220px;
}

.filters-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xs);
  background: var(--color-surface);
  font-family: inherit;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}

.filters-toggle:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.filters-toggle.active {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary);
}

.filter-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--color-primary);
  color: var(--color-surface);
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

.filter-block {
  padding-top: var(--spacing-sm);
  margin-top: var(--spacing-sm);
  border-top: 1px dashed var(--color-border-light);
}

.then-section {
  padding-top: var(--spacing-lg);
  margin-top: var(--spacing-sm);
  border-top: 1px solid var(--color-border-light);
}

.then-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--spacing-sm);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.info-icon-wrap {
  display: inline-flex;
}

.info-icon {
  width: 14px;
  height: 14px;
  color: var(--color-text-tertiary);
  cursor: help;
}

.resource-types-card {
  margin-bottom: var(--spacing-lg);
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
}

.resource-types-header {
  padding: 14px var(--spacing-xl);
  border-bottom: 1px solid var(--color-border-light);
}

.resource-types-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-lg) var(--spacing-xl);
  background: var(--color-muted);
}

.resource-types-panel {
  padding: var(--spacing-lg) var(--spacing-xl);
  background: var(--color-surface);
  border-radius: var(--radius-xs);
  box-shadow: var(--shadow-sm);
}

.dest-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  padding: var(--spacing-xl);
  background: var(--color-muted);
  border-radius: var(--radius-sm);
}

.dest-radio-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
}

.dest-radio-group :deep(.el-radio) {
  margin-right: 0;
  height: auto;
}

.dest-hint {
  margin: 0;
}

.dest-input :deep(.el-input__wrapper) {
  background: var(--color-surface);
}

.request-body-mode-group {
  margin-left: var(--spacing-md);
}

.request-body-mode-group :deep(.el-radio) {
  margin-right: var(--spacing-md);
  height: auto;
}

.request-body-mode-group :deep(.el-radio__label) {
  font-size: var(--font-size-sm);
}

.dest-advanced {
  align-items: center;
}

.add-condition-wrap {
  display: block;
  margin-top: var(--spacing-md);
}

.add-condition-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 38px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-xs);
  background: none;
  font-family: inherit;
  font-size: var(--font-size-sm);
  color: var(--color-primary);
  cursor: pointer;
}

.add-condition-btn svg {
  width: 14px;
  height: 14px;
}

.add-condition-btn:disabled {
  border-color: var(--color-border-light);
  color: var(--color-text-tertiary);
  cursor: not-allowed;
}

.payload-row {
  margin-top: var(--spacing-sm);
}

.op-row {
  margin-bottom: var(--spacing-xs);
}

/* ── QueryParam 参数修改行（对齐 Requestly） ── */

.param-mod-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);
}

.param-mod-type {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
  flex: none;
  width: 96px;
  padding: 0;
  border: none;
  background: none;
  font-family: inherit;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  cursor: pointer;
}

.param-mod-caret {
  width: 12px;
  height: 12px;
  color: var(--color-text-tertiary);
}

.param-mod-name,
.param-mod-value {
  flex: 1;
  min-width: 0;
}

.param-mod-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--radius-xs);
  background: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
}

.param-mod-remove:hover {
  color: var(--color-error);
}

.param-mod-remove svg {
  width: 12px;
  height: 12px;
}

.param-mod-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--spacing-sm);
  margin-left: 104px;
  height: 32px;
  padding: 0 14px;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-xs);
  background: none;
  font-family: inherit;
  font-size: var(--font-size-sm);
  color: var(--color-primary);
  cursor: pointer;
}

.param-mod-add:hover {
  border-color: var(--color-primary);
}

.param-mod-add svg {
  width: 13px;
  height: 13px;
}

.op-section-title {
  margin: var(--spacing-sm) 0 var(--spacing-xs);
  font-size: var(--font-size-sm);
}

.body-input {
  margin-top: var(--spacing-sm);
}

.code-input :deep(textarea) {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
}

.code-meta {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-xs);
}

.no-margin {
  margin: 0;
}

.wrap {
  flex-wrap: wrap;
}
</style>

<style>
/* 行操作下拉（el-dropdown 传送至 body，非 scoped） */
.rule-more-actions-dropdown {
  --el-dropdown-menuItem-hover-fill: var(--color-muted);
  --el-dropdown-menuItem-hover-color: var(--color-text-primary);
  --el-bg-color-overlay: var(--color-surface);
  border-radius: var(--radius-xs);
  border: 1px solid var(--color-border-light);
  box-shadow: var(--shadow-md);
}

.rule-more-actions-dropdown .el-dropdown-menu {
  padding: 4px;
}

.rule-more-actions-dropdown .el-dropdown-menu__item {
  min-width: 160px;
  height: 36px;
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--radius-xs);
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  line-height: 20px;
  letter-spacing: 0.25px;
}

.rule-more-actions-dropdown .el-dropdown-menu__item .menu-icon {
  width: 16px;
  height: 16px;
  margin-right: 8px;
  color: inherit;
}

.rule-more-actions-dropdown .el-dropdown-menu__item.danger-item,
.rule-more-actions-dropdown .el-dropdown-menu__item.danger-item:hover {
  color: var(--color-error);
}

/* ── 新建规则下拉（el-popover 传送至 body，非 scoped；对齐 Requestly RuleSelectionList） ── */

.rule-picker-popover.el-popover.el-popper {
  padding: 0;
  overflow: hidden;
  background: var(--color-surface);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
}

.rule-picker-popover .el-popper__arrow {
  display: none;
}

.rule-picker-popover .rule-picker-list {
  display: flex;
  flex-direction: column;
  max-height: 480px;
  padding: 12px;
  overflow: auto;
}

.rule-picker-popover .rule-picker-section + .rule-picker-section {
  margin-top: 4px;
}

.rule-picker-popover .rule-picker-category {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 0;
}

.rule-picker-popover .rule-picker-category .title {
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.rule-picker-popover .rule-picker-category .divider {
  flex: 1;
  height: 1px;
  background: var(--color-border-light);
}

.rule-picker-popover .rule-picker-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  width: 100%;
  padding: 12px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: var(--radius-xs);
  transition: background var(--transition-fast);
}

.rule-picker-popover .rule-picker-item:hover {
  background: var(--color-muted);
}

.rule-picker-popover .rule-picker-item .icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  color: var(--color-text-secondary);
}

.rule-picker-popover .rule-picker-item .details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.rule-picker-popover .rule-picker-item .details .title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  line-height: 20px;
  color: var(--color-text-primary);
}

.rule-picker-popover .rule-picker-item .details .desc {
  overflow: hidden;
  font-size: var(--font-size-xs);
  line-height: 14px;
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
