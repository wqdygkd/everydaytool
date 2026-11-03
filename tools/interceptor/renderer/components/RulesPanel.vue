<script setup lang="ts">
import type { IconName } from '../../../../renderer/shared/components/ui/icons'
import type { DelayRuleConfig, HeaderAction, HeaderOperation, HeadersRuleConfig, InterceptorRule, QueryParamAction, QueryParamModification, QueryParamRuleConfig, RedirectRuleConfig, ReplaceRuleConfig, RequestBodyMode, RequestRuleConfig, ResponseRuleConfig, RuleFilters, RuleOperator, RuleSourceKey, RuleType, ScriptRuleConfig, ScriptRunAt, ScriptWorld, UserAgentRuleConfig } from '../../../../shared/interceptor'
import { confirm } from '@renderer/shared/feedback'
import { useEventListener } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { REQUEST_METHODS, RESOURCE_TYPE_LABELS, RULE_DELAY_MAX_MS, RULE_TYPE_LABELS } from '../../../../shared/interceptor'
import { useInterceptorStore } from '../stores/interceptorStore'
import { RULE_TYPES, ruleTypeFromPath, ruleTypeRouteName } from '../tabs'

const route = useRoute()
const router = useRouter()
const store = useInterceptorStore()

const pickerVisible = ref(false)
const view = ref<'list' | 'editor'>('list')
const isExistingDraft = ref(false)
const draft = ref<InterceptorRule | null>(null)
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

// 规则类型过滤走路由（/tools/interceptor/rules/<type>）：URL 可深链
const activeType = computed<RuleType | null>(() => ruleTypeFromPath(route.path))

const ruleTypeFilterOptions: Array<{ value: RuleType | null, label: string }> = [
  { value: null, label: '全部类型' },
  ...RULE_TYPES.map(type => ({ value: type, label: RULE_TYPE_LABELS[type] })),
]

function selectRuleType(type: RuleType | null): void {
  router.push(type ? { name: ruleTypeRouteName(type) } : { name: 'tool-interceptor-rules' })
}

/** 编辑器面包屑仅「规则」可点：返回列表 */
function onEditorCrumbNavigate(index: number): void {
  if (index === 0) closeEditor()
}

const filterCounts = computed<Record<FilterKey, number>>(() => ({
  all: store.rules.length,
  pinned: store.rules.filter(rule => rule.pinned).length,
  active: store.rules.filter(rule => rule.enabled).length,
}))

const visibleRules = computed<InterceptorRule[]>(() => {
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

function isSelected(rule: InterceptorRule): boolean {
  return selectedIds.value.has(rule.id)
}

function toggleSelect(rule: InterceptorRule): void {
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

/** UiTable 行类名：固定行标记 + 选中行高亮。 */
function rowClassName({ row }: { row: InterceptorRule }): string {
  return [row.pinned ? 'record-pinned' : '', isSelected(row) ? 'is-selected' : ''].join(' ')
}

/** UiTable 自定义排序（asc → desc → 取消，与原三轮点击一致）。 */
function onSortChange({ prop, order }: { prop: string, order: 'ascending' | 'descending' | null }): void {
  if (order === 'ascending') {
    sortKey.value = prop as SortKey
    sortDir.value = 'asc'
  } else if (order === 'descending') {
    sortKey.value = prop as SortKey
    sortDir.value = 'desc'
  } else {
    sortKey.value = null
    sortDir.value = 'asc'
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('zh-CN')
}

async function togglePin(rule: InterceptorRule): Promise<void> {
  await store.upsertRule({ ...rule, pinned: !rule.pinned || undefined })
}

async function duplicateRule(rule: InterceptorRule): Promise<void> {
  const copy: InterceptorRule = {
    ...structuredClone(toRaw(rule)),
    id: crypto.randomUUID(),
    name: `${rule.name} 副本`,
    pinned: undefined,
    updatedAt: new Date().toISOString(),
  }
  await store.upsertRule(copy)
  toast.success('已复制规则')
}

function handleRuleAction(command: string, rule: InterceptorRule): void {
  if (command === 'edit') openEditor(rule)
  else if (command === 'duplicate') void duplicateRule(rule)
  else if (command === 'delete') void remove(rule)
}

async function bulkToggleEnabled(): Promise<void> {
  const target = !bulkAllEnabled.value
  const rules = selectedRules.value
  for (const rule of rules) {
    await store.upsertRule({ ...rule, enabled: target, updatedAt: new Date().toISOString() })
  }
  toast.success(`${target ? '已启用' : '已停用'} ${rules.length} 条规则`)
}

async function bulkDelete(): Promise<void> {
  const rules = selectedRules.value
  try {
    await confirm(`确认删除选中的 ${rules.length} 条规则？`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  for (const rule of rules) {
    await store.deleteRule(rule.id)
    selectedIds.value.delete(rule.id)
  }
  toast.success('已删除选中规则')
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

interface TypeOption { type: RuleType, icon: IconName, title: string, desc: string }

// 分组对齐 Requestly New Rule 下拉：URL rewrites / API mocking / Headers / Others
const typeGroups: Array<{ title: string, options: TypeOption[] }> = [
  {
    title: 'URL 改写',
    options: [
      { type: 'redirect', icon: 'redirect', title: RULE_TYPE_LABELS.redirect, desc: '把匹配请求 30x 指到其他地址' },
      { type: 'replace', icon: 'replace', title: RULE_TYPE_LABELS.replace, desc: '在 URL 串中把 A 换成 B 再请求' },
      { type: 'queryParam', icon: 'queryParam', title: RULE_TYPE_LABELS.queryParam, desc: '增 / 删 / 清空 URL 查询参数' },
    ],
  },
  {
    title: 'API Mock',
    options: [
      { type: 'request', icon: 'request', title: RULE_TYPE_LABELS.request, desc: '静态替换或动态 JS 改写请求体' },
      { type: 'response', icon: 'response', title: RULE_TYPE_LABELS.response, desc: '状态码、响应体，或不调服务器直接返回' },
    ],
  },
  {
    title: '请求头',
    options: [
      { type: 'headers', icon: 'headers', title: RULE_TYPE_LABELS.headers, desc: '增删改头字段' },
      { type: 'userAgent', icon: 'userAgent', title: RULE_TYPE_LABELS.userAgent, desc: '覆盖 UA（模拟机型 / 环境）' },
    ],
  },
  {
    title: '其他',
    options: [
      { type: 'script', icon: 'script', title: RULE_TYPE_LABELS.script, desc: '在匹配页面注入自定义 JS（URL 留空 = 所有页面）' },
      { type: 'cancel', icon: 'cancel', title: RULE_TYPE_LABELS.cancel, desc: '拦截并断开连接' },
      { type: 'delay', icon: 'delay', title: RULE_TYPE_LABELS.delay, desc: `延迟指定毫秒后转发（上限 ${RULE_DELAY_MAX_MS / 1000}s）` },
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

/** UiTableColumn 插槽给的 row 是宽泛记录类型，这里收窄为规则类型。 */
function ruleOf(row: unknown): InterceptorRule {
  return row as InterceptorRule
}

/** UiSelect 的 value 声明不接受 null：「全部类型」一项运行期仍是 null，这里只放宽类型。 */
function ruleTypeOptionValue(value: RuleType | null): RuleType {
  return value as RuleType
}

// ─────────────────────────────────────────────────────────────
// 编辑器模板的非空视图
// 动作配置在 ensureDefaults 后一定存在；但模板里靠 v-if 收窄在这个分支规模下会被类型推断丢掉
// （v-model 生成的回调里尤其明显），所以每种配置给一份非空视图兜底：渲染时草稿里一定有该配置，
// 读到的就是同一个对象，v-model 的写回不受影响。兜底值与本文件 ensureDefaults 的默认值保持一致。
// ─────────────────────────────────────────────────────────────

const redirectForm = computed<RedirectRuleConfig>(() => draft.value?.redirect ?? { destination: '', statusCode: 302, preserveQueryParams: false })
/* UiSelect 原生 value 是字符串:状态码在消费侧转 Number */
const statusCodeOption = computed({
  get: () => String(redirectForm.value.statusCode),
  set: (v: string) => {
    redirectForm.value.statusCode = Number(v) as 301 | 302 | 307 | 308
  },
})
/* 多选过滤：chip 开关组。 */
function toggleInList(list: string[] | undefined, value: string) {
  if (!list) {
    return
  }
  const i = list.indexOf(value)
  if (i >= 0) {
    list.splice(i, 1)
  }
  else {
    list.push(value)
  }
}
const replaceForm = computed<ReplaceRuleConfig>(() => draft.value?.replace ?? { from: '', to: '' })
const queryParamForm = computed<QueryParamRuleConfig>(() => draft.value?.queryParam ?? { modifications: [] })
const delayForm = computed<DelayRuleConfig>(() => draft.value?.delay ?? { delayMs: 1000 })
const headersForm = computed<HeadersRuleConfig>(() => draft.value?.headers ?? { request: [], response: [] })
const userAgentForm = computed<UserAgentRuleConfig>(() => draft.value?.userAgent ?? { userAgent: '' })
const responseForm = computed<ResponseRuleConfig>(() => draft.value?.response ?? { mock: false })
const scriptForm = computed<ScriptRuleConfig>(() => draft.value?.script ?? { code: '', world: 'MAIN', runAt: 'document_start' })

/** 草稿类型（模板分支条件用）：条件只决定渲染哪一段，段内读的是各自的非空视图 */
const draftType = computed<RuleType | null>(() => draft.value?.type ?? null)

function keyLabel(key: RuleSourceKey): string {
  return keyOptions.find(option => option.value === key)?.label ?? key
}

function operatorLabel(operator: RuleOperator): string {
  return operatorOptions.find(option => option.value === operator)?.label ?? operator
}

function sourceSummary(rule: InterceptorRule): string {
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

function ensureDefaults(rule: InterceptorRule): void {
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
const requestBodyValue = computed({
  get: () => draft.value?.request?.value ?? '',
  // 写入仍落在草稿的 request 上（请求体归一化后 value 一定存在，这里只做类型兜底）
  set: (value: string) => {
    if (draft.value?.request) draft.value.request.value = value
  },
})

function switchRequestBodyMode(value: unknown): void {
  const mode: RequestBodyMode = value === 'code' ? 'code' : 'static'
  const config = draft.value?.request
  if (!config || requestBodyMode.value === mode) return
  requestBodyStash.value[requestBodyMode.value] = config.value ?? ''
  config.type = mode
  config.value = requestBodyStash.value[mode] || (mode === 'code' ? REQUEST_BODY_CODE_TEMPLATE : '')
}

function openEditor(rule?: InterceptorRule, type?: RuleType): void {
  const next: InterceptorRule = rule
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

function switchDraftType(type: RuleType): void {
  const current = draft.value
  if (!current || current.type === type) return
  current.type = type
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

useEventListener(window, 'keydown', handleEditorHotkey)

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
    toast.warning('请填写匹配值')
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
        toast.warning('请填写重定向目标地址')
        return
      }
      if (!/^https?:\/\//i.test(destination) && !/\$[1-9]/.test(destination)) {
        toast.warning('目标地址需以 http(s):// 开头（或用 $n 捕获组）')
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
        toast.warning('请填写要替换的原片段')
        return
      }
      rule.replace = { from, to: rule.replace?.to ?? '' }
      break
    }
    case 'queryParam': {
      const modifications = (rule.queryParam?.modifications ?? []).filter(mod => mod.action === 'removeAll' || mod.param.trim())
      if (!modifications.length) {
        toast.warning('请至少添加一个参数修改项')
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
        toast.warning('请至少添加一个头操作')
        return
      }
      rule.headers = { request, response }
      break
    }
    case 'userAgent': {
      const userAgent = rule.userAgent?.userAgent?.trim() ?? ''
      if (!userAgent) {
        toast.warning('请填写 User-Agent')
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
          toast.warning('请填写动态脚本')
          return
        }
      } else if (!value.length) {
        toast.warning('请填写替换后的请求体')
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
        toast.warning('请至少设置状态码 / 状态文案 / 响应体 / Mock 之一')
        return
      }
      rule.response = { statusCode, statusText, bodyReplace, mock }
      break
    }
    case 'script': {
      const code = rule.script?.code ?? ''
      if (!code.trim()) {
        toast.warning('请填写脚本正文')
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
  toast.success('规则已保存')
}

async function toggleEnabled(rule: InterceptorRule): Promise<void> {
  rule.enabled = !rule.enabled
  await store.upsertRule({ ...rule, updatedAt: new Date().toISOString() })
}

async function remove(rule: InterceptorRule): Promise<void> {
  try {
    await confirm(`确认删除规则「${rule.name}」？`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  await store.deleteRule(rule.id)
  selectedIds.value.delete(rule.id)
}
</script>

<template>
  <div v-if="view === 'list'">
    <div>
      <div class="rq-content-list-header">
        <div class="rq-content-list-header-filters">
          <UiSearchInput
            v-model="searchValue"
            variant="box"
            placeholder="搜索"
            clearable
            class="ctl-md"
            :size="16"
          />
          <div class="seg-filter" role="group" aria-label="规则过滤">
            <button v-for="option in filterOptions" :key="option.key" type="button" class="seg-filter-btn" :class="{ 'is-active': activeFilter === option.key }" @click="activeFilter = option.key">
              <UiIcon v-if="option.icon === 'pin'" name="pin" />
              <UiIcon v-else-if="option.icon === 'toggle'" name="toggle" />
              {{ option.label }}
              <UiChip v-if="filterCounts[option.key]" mono>
                {{ filterCounts[option.key] }}
              </UiChip>
            </button>
          </div>
          <UiSelect
            :model-value="activeType ?? ''"
            class="ctl-sm"
            :options="ruleTypeFilterOptions.map(option => ({ label: option.label, value: ruleTypeOptionValue(option.value) }))"
            @update:model-value="(v: string) => selectRuleType(v === '' ? null : v as RuleType)"
          />
        </div>
        <div class="rq-content-list-header-actions">
          <UiPopover
            :visible="pickerVisible"
            :width="400"
            content-class="rule-picker-popover"
            @update:visible="pickerVisible = $event"
          >
            <template #trigger>
              <UiButton type="primary">
                <UiIcon name="plus" class="btn-icon" />
                新建规则
              </UiButton>
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
                  <UiIcon :name="option.icon" class="icon" />
                  <span class="details">
                    <span class="title">{{ option.title }}</span>
                    <span class="desc">{{ option.desc }}</span>
                  </span>
                </button>
              </div>
            </div>
          </UiPopover>
        </div>
      </div>

      <UiTable
        class="rules-table"
        :data="visibleRules"
        :row-class-name="rowClassName"
        @row-dblclick="openEditor"
        @sort-change="onSortChange"
      >
        <UiTableColumn width="46" align="center">
          <template #header>
            <UiCheckbox
              :model-value="allVisibleSelected"
              :indeterminate="someVisibleSelected && !allVisibleSelected"
              :disabled="!visibleRules.length"
              @update:model-value="toggleSelectAll"
            />
          </template>
          <template #default="{ row }">
            <UiCheckbox :model-value="isSelected(ruleOf(row))" @update:model-value="toggleSelect(ruleOf(row))" />
          </template>
        </UiTableColumn>
        <UiTableColumn width="64" align="center">
          <template #default="{ row }">
            <UiIconButton
              icon="pin"
              :active="row.pinned"
              :label="row.pinned ? '取消固定' : '固定到列表'"
              @click="togglePin(ruleOf(row))"
            />
          </template>
        </UiTableColumn>
        <UiTableColumn prop="name" label="规则" sortable="custom" min-width="220">
          <template #default="{ row }">
            <button type="button" class="rule-name" :title="row.name" @click="openEditor(ruleOf(row))">
              {{ row.name }}
            </button>
          </template>
        </UiTableColumn>
        <UiTableColumn prop="type" label="类型" sortable="custom" width="200">
          <template #default="{ row }">
            <span class="rule-type-tag" :title="RULE_TYPE_LABELS[ruleOf(row).type]">
              <UiIcon :name="row.type" />
              <span class="rule-type-tag-name">{{ RULE_TYPE_LABELS[ruleOf(row).type] }}</span>
            </span>
          </template>
        </UiTableColumn>
        <UiTableColumn label="状态" width="130">
          <template #default="{ row }">
            <UiSwitchField :model-value="row.enabled" size="small" @update:model-value="() => toggleEnabled(ruleOf(row))" />
          </template>
        </UiTableColumn>
        <UiTableColumn prop="updatedAt" label="更新时间" sortable="custom" width="150">
          <template #default="{ row }">
            <span class="rule-updated-on">{{ formatDate(row.updatedAt) }}</span>
          </template>
        </UiTableColumn>
        <UiTableColumn width="110" align="right">
          <template #default="{ row }">
            <div class="rules-actions-container">
              <UiDropdown :items="[{ command: 'edit', label: '编辑', icon: 'pencil' }, { command: 'duplicate', label: '复制', icon: 'copy' }, { command: 'delete', label: '删除', icon: 'trash', danger: true }]" @command="(command: string) => handleRuleAction(command, ruleOf(row))">
                <template #trigger>
                  <UiButton text class="icon-btn" aria-label="更多操作">
                    <UiIcon name="more" />
                  </UiButton>
                </template>
              </UiDropdown>
            </div>
          </template>
        </UiTableColumn>
        <template #empty>
          <UiEmpty center padding="var(--spacing-2xl)">
            <template #title>
              还没有规则
            </template>
            规则在代理层改写请求：改请求头 / 改 body / 重定向 / 注入脚本。先选一个类型，剩下的照着填。
            <template #actions>
              <UiButton size="small" @click="pickerVisible = true">
                新建规则
              </UiButton>
            </template>
          </UiEmpty>
        </template>
      </UiTable>
    </div>

    <div v-if="view === 'list' && selectedRules.length" class="rq-bulk-action-bar-container">
      <div class="rq-bulk-action-bar-info-text">
        已选 {{ selectedRules.length }} 条规则
      </div>
      <UiGroup gap="sm">
        <UiButton size="small" @click="bulkToggleEnabled">
          {{ bulkAllEnabled ? '停用' : '启用' }}
        </UiButton>
        <UiButton size="small" type="danger" @click="bulkDelete">
          删除
        </UiButton>
        <UiButton size="small" text @click="clearSelection">
          取消
        </UiButton>
      </UiGroup>
    </div>
  </div>

  <div v-else-if="draft" class="rule-editor-screen">
    <nav class="rule-editor-sidebar">
      <div v-for="group in typeGroups" :key="group.title" class="rule-editor-group">
        <p class="rule-editor-group-title">
          {{ group.title }}
        </p>
        <button v-for="option in group.options" :key="option.type" type="button" class="rule-editor-menu-item" :class="{ 'is-active': draft.type === option.type }" @click="switchDraftType(option.type)">
          <UiIcon :name="option.icon" />
          <span>{{ option.title }}</span>
        </button>
      </div>
    </nav>

    <div class="rule-editor-main">
      <UiToolbar class="rule-editor-topbar">
        <UiIconButton icon="arrowLeft" label="返回列表" @click="closeEditor" />
        <UiBreadcrumb
          :items="[{ label: '规则' }, { label: isExistingDraft ? '编辑规则' : '创建规则' }]"
          @navigate="onEditorCrumbNavigate"
        />
        <template #end>
          <span class="muted enable-label">启用</span>
          <UiSwitchField v-model="draft.enabled" size="small" />
          <UiButton type="primary" @click="save">
            保存规则
            <span class="kbd-hint">Ctrl S</span>
          </UiButton>
        </template>
      </UiToolbar>

      <div class="rule-editor-body">
        <div class="rule-title-row">
          <UiInput
            v-if="editingName"
            v-model="draft.name"
            class="rule-title-input"
            @blur="editingName = false"
            @keydown.enter="editingName = false"
          />
          <button v-else type="button" class="rule-title" title="点击重命名" @click="editingName = true">
            {{ draft.name || '未命名规则' }}
            <UiIcon name="pencil" class="pencil-icon" />
          </button>
        </div>
        <div class="rule-description-row">
          <UiInput
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

        <div v-if="draft.type === 'request'" class="editor-card">
          <div class="editor-card-header">
            <span class="panel-header">选择资源类型</span>
          </div>
          <div class="muted-panel">
            <UiRadioGroup model-value="rest" class="dest-radio-group radio-flush">
              <UiRadio value="rest">
                REST API
              </UiRadio>
              <UiRadio value="graphql" disabled>
                GraphQL API
              </UiRadio>
            </UiRadioGroup>
            <UiHint>
              GraphQL 请求体改写暂未支持，当前按 REST API 处理。
            </UiHint>
          </div>
        </div>

        <div class="editor-card">
          <button type="button" class="editor-card-header rule-pair-header" @click="ifCardCollapsed = !ifCardCollapsed">
            <span class="panel-header">{{ ifCardLabel }}</span>
            <svg class="chevron" :class="{ rotated: ifCardCollapsed }" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5.5 12.5 10 8l4.5 4.5" />
            </svg>
          </button>

          <div v-show="!ifCardCollapsed" class="rule-pair-body">
            <div class="source-row">
              <UiSelect v-model="draft.source.key" class="ctl-xs" :options="keyOptions.map(option => ({ label: option.label, value: option.value }))" />
              <UiSelect v-model="draft.source.operator" class="ctl-md" :options="operatorOptions.map(option => ({ label: option.label, value: option.value }))" />
              <UiInput
                v-model="draft.source.value"
                :placeholder="draft.type === 'script' ? '留空 = 应用于所有页面（例如 example.com/checkout）' : '例如 example.com/api'"
                class="ctl-fill"
              />
              <UiButton
                v-if="draft.type !== 'script'"
                :type="countActiveFilters(draft.filters) > 0 ? 'primary' : 'default'"
                :plain="countActiveFilters(draft.filters) > 0"
                @click="filterPanelOpen = !filterPanelOpen"
              >
                高级过滤
                <UiChip v-if="countActiveFilters(draft.filters)" tone="primary" mono>
                  {{ countActiveFilters(draft.filters) }}
                </UiChip>
              </UiButton>
            </div>

            <div v-if="draft.type !== 'script'" v-show="filterPanelOpen" class="filter-block">
              <UiGroup wrap gap="sm">
                <div class="chip-filter ctl-md" role="group" aria-label="方法过滤">
                  <button v-for="method in REQUEST_METHODS" :key="method" type="button" class="chip-toggle" :class="{ 'is-on': draft.filters?.requestMethod?.includes(method) }" @click="toggleInList(draft.filters?.requestMethod, method)">
                    {{ method }}
                  </button>
                </div>
                <div class="chip-filter ctl-md" role="group" aria-label="资源类型过滤">
                  <button v-for="(label, value) in RESOURCE_TYPE_LABELS" :key="value" type="button" class="chip-toggle" :class="{ 'is-on': draft.filters?.resourceType?.includes(value) }" @click="toggleInList(draft.filters?.resourceType, value)">
                    {{ label }}
                  </button>
                </div>
                <UiInput v-model="draft.filters!.pageUrl" placeholder="页面 URL 包含…（如 example.com/checkout）" class="ctl-lg" />
              </UiGroup>
              <UiGroup wrap gap="sm" class="payload-row">
                <UiCheckbox v-model="payloadEnabled">
                  请求体过滤
                </UiCheckbox>
                <template v-if="draft.filters?.requestPayload">
                  <UiInput v-model="draft.filters.requestPayload.key" placeholder="键（JSON 顶层 / GraphQL 变量 / 表单参数）" class="ctl-lg" />
                  <UiSelect v-model="draft.filters.requestPayload.operator" class="ctl-xs" :options="[{ label: '等于', value: 'equals' }, { label: '包含', value: 'contains' }]" />
                  <UiInput v-model="draft.filters.requestPayload.value" placeholder="值" class="ctl-md" />
                </template>
                <UiHint block>
                  命中请求体过滤的规则会先缓冲请求体（超大请求体会被拒）
                </UiHint>
              </UiGroup>
            </div>

            <div class="then-section">
              <div class="then-label">
                <span>{{ thenSectionLabel }}</span>
                <UiRadioGroup
                  v-if="draft.type === 'request' && draft.request"
                  class="request-body-mode-group radio-flush"
                  :model-value="requestBodyMode"
                  @change="switchRequestBodyMode"
                >
                  <UiRadio value="static">
                    静态数据
                    <span class="ui-tip" title="填写要随请求发送的静态 JSON 请求体">
                      <span class="info-icon-wrap">
                        <UiIcon name="info" class="info-icon" />
                      </span>
                    </span>
                  </UiRadio>
                  <UiRadio value="code">
                    动态（JavaScript）
                    <span class="ui-tip" title="编写 JavaScript 代码改写现有请求体">
                      <span class="info-icon-wrap">
                        <UiIcon name="info" class="info-icon" />
                      </span>
                    </span>
                  </UiRadio>
                </UiRadioGroup>
                <span v-if="draft.type === 'redirect'" class="ui-tip" title="定义要将原始请求重定向到的目标地址">
                  <span class="info-icon-wrap">
                    <UiIcon name="info" class="info-icon" />
                  </span>
                </span>
              </div>

              <template v-if="draftType === 'redirect'">
                <div class="muted-panel">
                  <UiRadioGroup v-model="redirectTargetType" class="dest-radio-group radio-flush">
                    <UiRadio value="url">
                      另一个 URL
                    </UiRadio>
                    <UiRadio value="local" disabled>
                      本机文件
                    </UiRadio>
                    <UiRadio value="fileserver" disabled>
                      文件服务器
                    </UiRadio>
                  </UiRadioGroup>
                  <UiHint>
                    「本机文件 / 文件服务器」后续版本支持，当前仅支持重定向到 URL。
                  </UiHint>
                  <UiInput v-model="redirectForm.destination" placeholder="例如 https://new-example.com（支持 $1 捕获组）" class="dest-input" />
                  <UiGroup wrap gap="sm">
                    <UiSelect v-model="statusCodeOption" class="ctl-md" :options="[{ label: '302 临时', value: '302' }, { label: '301 永久', value: '301' }, { label: '307 保留方法', value: '307' }, { label: '308 永久 + 保留方法', value: '308' }]" />
                    <UiCheckbox :model-value="redirectForm.preserveQueryParams ?? false" @update:model-value="redirectForm.preserveQueryParams = $event">
                      目标未带查询串时保留原查询参数
                    </UiCheckbox>
                  </UiGroup>
                  <UiHint block>
                    源用「正则匹配 / 通配符」时，目标里的 $1、$2 会替换为捕获内容（通配符 * 也可用 $1 取到）。
                  </UiHint>
                </div>
              </template>

              <template v-else-if="draftType === 'replace'">
                <UiGroup wrap gap="sm">
                  <UiInput v-model="replaceForm.from" placeholder="原片段（在完整 URL 中把…）" class="ctl-fill" />
                  <span class="muted">→</span>
                  <UiInput v-model="replaceForm.to" placeholder="替换为" class="ctl-fill" />
                </UiGroup>
                <UiHint block>
                  只替换 URL 中第一处匹配；替换后的 URL 直接作为新请求目标（浏览器不可见，比重定向更透明）。
                </UiHint>
              </template>

              <template v-else-if="draftType === 'queryParam'">
                <div v-for="mod in queryParamForm.modifications" :key="mod.id" class="param-mod-row">
                  <UiDropdown :items="[{ command: 'add', label: '添加 / 替换' }, { command: 'remove', label: '删除' }, { command: 'removeAll', label: '清空全部' }]" @command="(action: string) => setQueryModAction(mod, action as QueryParamAction)">
                    <template #trigger>
                      <UiButton text class="param-mod-type">
                        {{ queryParamRowLabels[mod.action] }}
                        <UiIcon name="chevronDown" class="param-mod-caret" />
                      </UiButton>
                    </template>
                  </UiDropdown>
                  <UiPathField v-model="mod.param" :disabled="mod.action === 'removeAll'" class="param-mod-name" placeholder="参数名">
                    <template #prepend>
                      参数
                    </template>
                  </UiPathField>
                  <UiPathField v-model="mod.value" :disabled="mod.action !== 'add'" class="param-mod-value" placeholder="参数值">
                    <template #prepend>
                      值
                    </template>
                  </UiPathField>
                  <span class="ui-tip" title="移除">
                    <UiIconButton icon="close" tone="danger" label="移除" @click="removeQueryMod(mod.id)" />
                  </span>
                </div>
                <UiButton class="dashed-add-btn param-mod-add" @click="addQueryMod">
                  <UiIcon name="plus" />
                  添加参数修改
                </UiButton>
              </template>

              <template v-else-if="draftType === 'cancel'">
                <UiHint>
                  命中后直接断开连接，浏览器表现为请求失败（类似网络异常，页面无法拿到 4xx 状态）。
                </UiHint>
              </template>

              <template v-else-if="draftType === 'delay'">
                <UiGroup wrap gap="sm">
                  <input
                    v-model.number="delayForm.delayMs"
                    type="number"
                    class="ui-input is-default"
                    :min="1"
                    :max="RULE_DELAY_MAX_MS"
                    :step="500"
                  >
                  <span class="muted">毫秒（上限 {{ RULE_DELAY_MAX_MS / 1000 }}s），延迟后照常请求上游</span>
                </UiGroup>
              </template>

              <template v-else-if="draftType === 'headers'">
                <div class="muted op-section-title">
                  请求头操作
                </div>
                <UiGroup v-for="op in headersForm.request ?? []" :key="op.id" wrap gap="sm" class="op-row">
                  <UiSelect :model-value="op.action ?? ''" class="ctl-sm" :options="headerActionOptions.map(option => ({ label: option.label, value: option.value }))" @update:model-value="op.action = $event as HeaderAction" />
                  <UiInput v-model="op.name" placeholder="头名称" class="ctl-md" />
                  <UiInput v-model="op.value" :disabled="op.action === 'remove'" placeholder="值" class="ctl-fill" />
                  <UiButton text type="danger" @click="removeHeaderOp('request', op.id)">
                    移除
                  </UiButton>
                </UiGroup>
                <UiButton size="small" text type="primary" @click="addHeaderOp('request')">
                  + 请求头操作
                </UiButton>
                <div class="muted op-section-title">
                  响应头操作
                </div>
                <UiGroup v-for="op in headersForm.response ?? []" :key="op.id" wrap gap="sm" class="op-row">
                  <UiSelect :model-value="op.action ?? ''" class="ctl-sm" :options="headerActionOptions.map(option => ({ label: option.label, value: option.value }))" @update:model-value="op.action = $event as HeaderAction" />
                  <UiInput v-model="op.name" placeholder="头名称" class="ctl-md" />
                  <UiInput v-model="op.value" :disabled="op.action === 'remove'" placeholder="值" class="ctl-fill" />
                  <UiButton text type="danger" @click="removeHeaderOp('response', op.id)">
                    移除
                  </UiButton>
                </UiGroup>
                <UiButton size="small" text type="primary" @click="addHeaderOp('response')">
                  + 响应头操作
                </UiButton>
              </template>

              <template v-else-if="draftType === 'userAgent'">
                <UiGroup wrap gap="sm">
                  <UiInput v-model="userAgentForm.userAgent" placeholder="自定义 UA 字符串" class="ctl-fill" />
                  <UiSelect placeholder="常用预设" class="ctl-md" :options="uaPresets" @update:model-value="applyUaPreset" />
                </UiGroup>
              </template>

              <template v-else-if="draftType === 'request'">
                <UiCodeArea
                  v-model="requestBodyValue"
                  :rows="requestBodyMode === 'code' ? 12 : 8"
                  :placeholder="requestBodyMode === 'code' ? 'async function modifyRequestBody(args) { … }' : '填写要发送的静态 JSON 请求体'"
                  :meta="`${requestBodyValue.length} 字符`"
                  class="body-input"
                />
                <UiHint block>
                  静态 → 整体替换请求体；动态 → edt 代理侧沙箱执行 modifyRequestBody(args)，入参 { method, url, body, bodyAsJson }，返回新请求体（支持 async；1 秒超时、出错保留原体）。仅对文本类请求体（JSON / 表单等）生效；超过 8MB 的请求体会直接拒绝（502）。
                </UiHint>
              </template>

              <template v-else-if="draftType === 'response'">
                <UiGroup wrap gap="sm">
                  <span class="muted">状态码</span>
                  <input v-model.number="responseForm.statusCode" type="number" class="ctl-xs ctl-input" :min="100" :max="599" placeholder="原始">
                  <input v-model="responseForm.statusText" type="text" class="ctl-md ctl-input" placeholder="状态文案（如 Teapot）">
                  <UiCheckbox :model-value="responseForm.mock ?? false" @update:model-value="responseForm.mock = $event">
                    Mock（不调服务器直接返回）
                  </UiCheckbox>
                </UiGroup>
                <textarea
                  v-model="responseForm.bodyReplace"
                  :rows="5"
                  placeholder="静态替换响应体 / Mock 返回体（留空 = 不改体；Mock 时返回空体）"
                  class="body-input"
                />
              </template>

              <template v-else-if="draftType === 'script'">
                <UiGroup wrap gap="sm">
                  <UiSelect v-model="scriptForm.world" class="ctl-lg" :options="worldOptions.map(option => ({ label: option.label, value: option.value }))" />
                  <UiSelect v-model="scriptForm.runAt" class="ctl-lg" :options="runAtOptions.map(option => ({ label: option.label, value: option.value }))" />
                </UiGroup>
                <UiCodeArea
                  v-model="scriptForm.code"
                  :rows="12"
                  placeholder="// 脚本正文（JS），在匹配页面注入执行"
                  :meta="`${scriptForm.code.length} 字符`"
                  class="body-input"
                />
                <UiHint block>
                  脚本存 edt，经 WS 同步给扩展后用 chrome.userScripts 注册；改动对已打开的页面在下次导航生效。MAIN 世界无扩展 API；ISOLATED 世界可将结果经 window.postMessage 互动。
                </UiHint>
              </template>
            </div>
          </div>
        </div>

        <span class="ui-tip" title="暂不支持多条件（单规则单动作）">
          <span class="add-condition-wrap">
            <UiButton class="dashed-add-btn dashed-add-btn--block" disabled>
              <UiIcon name="plus" />
              添加新条件
            </UiButton>
          </span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── 列表屏（UiTable + 语义令牌，与全应用表格一致） ── */

.rq-content-list-header {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) 0;
}

.rq-content-list-header-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

/* 过滤分段钮样式由全局工具类和组件令牌控制。 */

.rq-content-list-header-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.btn-icon {
  width: 14px;
  height: 14px;
  margin-right: var(--spacing-sm);
}

/* 规则表：主题令牌（muted 表头 / hover 行 / 圆角卡片 / 选中行）已在 main.scss 绑定 */
.rules-table {
  /* 固定行：首列左侧警示色标记（inset 不占布局，业务专属） */
  :deep(.ui-table tbody tr.record-pinned td:first-child) {
    box-shadow: inset 3px 0 0 var(--color-warning);
  }
}

/* 图标钮：更多操作触发钮沿用原生按钮挂载；其余图标钮使用 UiIconButton。 */
.icon-btn {
  width: var(--control-height);
  height: var(--control-height);
  padding: 0;
  flex-shrink: 0;
  color: var(--color-text-secondary);

  &:hover {
    color: var(--color-text-primary);
    background: var(--color-border-light);
  }
}

.rule-name {
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  /* 规则名是 12px 可点文字：取墨档蓝（5.05:1），亮档只有 3.31:1 */
  color: var(--color-primary-strong);
  font-family: inherit;
  font-size: var(--font-size-sm);
  line-height: var(--line-height-control);
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--transition-fast);
}

.rule-name:hover {
  color: color-mix(in oklab, var(--color-primary-strong) 82%, #000);
}

.rule-type-tag {
  display: inline-flex;
  align-items: center;
  column-gap: var(--spacing-sm);
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
  gap: var(--spacing-sm);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-control);
}

.rules-actions-container {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

/* ── 批量操作栏（底部浮动胶囊；按钮使用 UiButton 变体） ── */

.rq-bulk-action-bar-container {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: var(--spacing-sm);
  position: fixed;
  left: 50%;
  bottom: var(--spacing-2xl);
  transform: translateX(-50%);
  z-index: 10;
  width: max-content;
  padding: var(--spacing-md) var(--spacing-lg);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xs);
  background: var(--color-raised);
  /* 玻璃：底部浮动胶囊压着整页规则列表，需磨平背后的内容 */
  backdrop-filter: var(--glass-raised);
  box-shadow: var(--shadow-lg);
}

.rq-bulk-action-bar-info-text {
  flex-shrink: 0;
  min-width: 110px;
  margin-right: auto;
  color: var(--color-text-secondary);
  text-align: center;
  font-size: var(--font-size-sm);
  line-height: var(--line-height-control);
  letter-spacing: 0.25px;
}

/* ── 规则编辑器（整页视图） ── */

.rule-editor-screen {
  /* QueryParam 参数修改行：类型下拉按钮宽度（添加按钮左边距与之对齐，单一来源） */
  --param-mod-type-w: 96px;
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-lg);
  width: 100%;
}

/* 类型侧栏：原生 nav(紧凑行高、选中态品牌浅底) */
.rule-editor-sidebar {
  position: sticky;
  top: 0;
  flex: 0 0 212px;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  padding: var(--spacing-sm) 0;
  border-right: 0;
  background: transparent;
}

.rule-editor-group-title {
  padding: var(--spacing-xs) var(--spacing-sm);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.rule-editor-menu-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  width: calc(100% - 8px);
  height: var(--control-height);
  margin: 0 var(--spacing-xs);
  padding: 0 var(--spacing-sm);
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--color-fill);
  }

  &.is-active {
    background: var(--color-primary-soft);
  }
}

/* 列表头过滤胶囊（原生按钮组）。 */
.seg-filter {
  display: flex;
  gap: var(--spacing-xs);
  flex-wrap: wrap;
}

.seg-filter-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  height: var(--control-height);
  padding: 0 var(--spacing-md);
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover { color: var(--color-text-primary); }

  &.is-active {
    color: var(--color-text-primary);
    background: var(--color-raised);
  }
}

/* 多选过滤 chip 开关组。 */
.chip-filter {
  display: flex;
  gap: var(--spacing-xs);
  flex-wrap: wrap;
  align-items: center;
}

.chip-toggle {
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-field);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: all var(--transition-fast);

  &.is-on {
    border-color: var(--color-primary);
    background: var(--color-primary-soft);
    color: var(--color-primary-strong);
  }
}

.rule-editor-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* 顶栏用 UiToolbar（返回钮 + UiBreadcrumb + 右侧动作） */
.rule-editor-topbar {
  padding-bottom: var(--spacing-md);
}

.enable-label {
  font-size: var(--font-size-sm);
}

.kbd-hint {
  margin-left: var(--spacing-sm);
  padding: 1px var(--spacing-sm);
  border: 1px solid color-mix(in srgb, var(--color-on-solid) 45%, transparent);
  border-radius: var(--radius-xs);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  line-height: 14px;
  opacity: 0.9;
}

.rule-editor-body {
  padding: var(--spacing-xl) 0 var(--spacing-3xl);
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
  gap: var(--spacing-sm);
  padding: 0;
  border: 0;
  background: none;
  font-family: inherit;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-medium);
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

.rule-title-input :deep(.ui-input) {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-medium);
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
  color: var(--color-primary-strong);
}

/* 编辑器卡片（If 卡 / 资源类型卡同构）；卡片间距由相邻兄弟规则承担 */
.editor-card {
  overflow: hidden;
  background: var(--color-raised);
  /* 玻璃：卡片浮在透明画布上，按 raised 角色取模糊（不透明窗口下为 none） */
  backdrop-filter: var(--glass-raised);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
}

.editor-card + .editor-card {
  margin-top: var(--spacing-lg);
}

.editor-card-header {
  padding: var(--spacing-md) var(--spacing-xl);
  border-bottom: 1px solid var(--color-border-light);
}

/* If 卡片头：整行可点 + 右侧 chevron */
.rule-pair-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
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
  gap: var(--spacing-sm);
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

/* 灰底嵌层面板（资源类型选择 / 重定向目标同构） */
.muted-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-lg) var(--spacing-xl);
  background: var(--color-raised);
  border-radius: var(--radius-sm);
}

.dest-radio-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
}

/* 目标输入框贴在 raised 面板上：用卡片底色，避免在面板里出现第二层「输入框色块」 */
.dest-input :deep(.ui-input) {
  background: var(--color-raised);
}

.request-body-mode-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  margin-left: var(--spacing-md);
}

.request-body-mode-group :deep(.ui-radio-text) {
  font-size: var(--font-size-sm);
}

.add-condition-wrap {
  display: block;
  margin-top: var(--spacing-md);
}

/* 虚线新增钮：UiButton + 虚线边框（添加新条件 / 添加参数修改同构） */
.dashed-add-btn {
  border-style: dashed;
  border-color: var(--color-border);
  color: var(--color-primary-strong);

  &:hover,
  &:focus {
    border-color: var(--color-primary);
    background: none;
    color: var(--color-primary-strong);
  }

  &:disabled,
  &:disabled:hover {
    border-color: var(--color-border-light);
    background: none;
    color: var(--color-text-tertiary);
  }
}

/* 占满整行的变体（暂不支持的「添加新条件」） */
.dashed-add-btn--block {
  width: 100%;
}

.payload-row {
  margin-top: var(--spacing-sm);
}

.op-row {
  margin-bottom: var(--spacing-xs);
}

/* ── QueryParam 参数修改行 ── */

.param-mod-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-sm);
}

.param-mod-type {
  flex: none;
  width: var(--param-mod-type-w);
  padding: 0;
  justify-content: flex-start;
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.param-mod-caret {
  width: 12px;
  height: 12px;
  margin-left: auto;
  color: var(--color-text-tertiary);
}

.param-mod-name,
.param-mod-value {
  flex: 1;
  min-width: 0;
}

/* 与参数修改行的类型列左对齐（宽度单一来源见 .rule-editor-screen） */
.param-mod-add {
  margin-top: var(--spacing-sm);
  margin-left: calc(var(--param-mod-type-w) + var(--spacing-sm));
}

.op-section-title {
  margin: var(--spacing-sm) 0 var(--spacing-xs);
  font-size: var(--font-size-sm);
}

.body-input {
  margin-top: var(--spacing-sm);
}

/* 原生输入件：与 UiInput 同一套令牌。 */
.ctl-input,
.ctl-num,
textarea.body-input {
  height: var(--control-height);
  min-width: 0;
  padding: 0 11px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-field);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-sm);

  &:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px var(--color-primary) inset;
  }
}

textarea.body-input {
  height: auto;
  padding: var(--spacing-sm) 11px;
  font-family: var(--font-mono);
  resize: vertical;
}
</style>

<style>
/* 新建规则下拉(UiPopover 传送至 body,非 scoped) */
.rule-picker-popover.ui-popover-content {
  padding: 0;
  overflow: hidden;
  background: var(--color-raised);
  /* 玻璃：popover 传送到 body，背后是整页内容，需自己承担模糊 */
  backdrop-filter: var(--glass-pop);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
}

.rule-picker-popover .rule-picker-list {
  display: flex;
  flex-direction: column;
  max-height: 480px;
  padding: var(--spacing-md);
  overflow: auto;
}

.rule-picker-popover .rule-picker-section + .rule-picker-section {
  margin-top: var(--spacing-xs);
}

.rule-picker-popover .rule-picker-category {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
  padding: var(--spacing-xs) 0;
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
  gap: var(--spacing-sm);
  align-items: flex-start;
  width: 100%;
  padding: var(--spacing-md);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: var(--radius-xs);
  transition: background var(--transition-fast);
}

.rule-picker-popover .rule-picker-item:hover {
  background: var(--color-raised);
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
  gap: var(--spacing-xs);
  min-width: 0;
}

.rule-picker-popover .rule-picker-item .details .title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-control);
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
