// interceptor（拦截器）共享类型：规则模型 / 处理名单 / 扩展 WS 协议 / 流量条目。
// 纯类型与常量（前端与 Node 后端共用）；扩展为纯 JS，按同一 JSON 协议通信。
// 设计定稿见 docs/interceptor.md。

/** 捆绑扩展的固定 ID：由 manifest.key（公钥）推导，两侧硬编码用于 Origin 校验 */
export const INTERCEPTOR_EXTENSION_ID = 'hlinfcmdeamelkpdemppomgncenalong'

/** 控制通道（WS）端口：基准 + 扫描范围（edt 占首个空闲端口，扩展按同段探测） */
export const INTERCEPTOR_WS_PORT_BASE = 59763
export const INTERCEPTOR_WS_PORT_RANGE = 5

/**
 * 代理端口：首次启动在该段内随机取一个空闲端口并落盘（之后固定），
 * 避免 8080 这类常被其它工具占用的「公共端口」。手动修改范围见 MIN/MAX。
 */
export const INTERCEPTOR_PROXY_PORT_RANDOM_MIN = 20000
export const INTERCEPTOR_PROXY_PORT_RANDOM_MAX = 59000
export const INTERCEPTOR_PROXY_PORT_MIN = 1024
export const INTERCEPTOR_PROXY_PORT_MAX = 65535

/** 流量条目请求/响应体落内存与下发的截断上限（字符） */
export const TRAFFIC_BODY_MAX_CHARS = 64 * 1024
/** 流量环形缓冲条数上限（v1 只存内存，不落库） */
export const TRAFFIC_RING_SIZE = 1000

// ---------------------------------------------------------------------------
// 处理名单（edt 处理层过滤器：谁被拆包/改包/记日志）
// ---------------------------------------------------------------------------

export const SOURCE_KEY_LABELS: Record<RuleSourceKey, string> = {
  url: 'URL',
  host: '主机',
  path: '路径',
}

export const SOURCE_OPERATOR_LABELS: Record<RuleOperator, string> = {
  equals: '等于',
  contains: '包含',
  matches: '正则',
  wildcard: '通配',
}

// ---------------------------------------------------------------------------
// 规则匹配源求值（处理名单不用这套：名单只按 origin 相等判定，见 targetMatchesOrigin）
// ---------------------------------------------------------------------------

const SOURCE_REGEX_CACHE = new Map<string, RegExp | null>()
const SOURCE_REGEX_CACHE_MAX = 200

/** 用户输入驱动的正则编译（非法即 null，带 FIFO 上限防无限增长） */
export function compileSourceRegex(pattern: string): RegExp | null {
  const cached = SOURCE_REGEX_CACHE.get(pattern)
  if (cached !== undefined) return cached
  let compiled: RegExp | null = null
  try {
    compiled = new RegExp(pattern)
  } catch {
    compiled = null
  }
  if (SOURCE_REGEX_CACHE.size >= SOURCE_REGEX_CACHE_MAX) {
    const oldest = SOURCE_REGEX_CACHE.keys().next().value
    if (oldest !== undefined) SOURCE_REGEX_CACHE.delete(oldest)
  }
  SOURCE_REGEX_CACHE.set(pattern, compiled)
  return compiled
}

/** 通配模式 → 正则：`*` 任意串、`?` 单字符 */
export function wildcardToRegex(pattern: string, withCaptures = false): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const star = withCaptures ? '(.*)' : '.*'
  return new RegExp(`^${escaped.replace(/\*/g, star).replace(/\?/g, '.')}$`)
}

export interface SourceMatchContext {
  /** 完整 URL（含协议与查询串，不含 hash） */
  url: string
  host: string
  /** 路径 + 查询串，如 `/a/b?x=1` */
  path: string
}

/**
 * 匹配源求值（规则专用的单点实现）：
 * - `key` 选中被比较的字符串（url / host / path），
 * - `operator` 决定比较方式（等于 / 包含 / 正则 / 通配）。
 * host 键按小写比较（域名不分大小写），其余键原样比较。
 */
export function matchSource(source: RuleSource, ctx: SourceMatchContext): boolean {
  const isHostKey = source.key === 'host'
  const value = isHostKey ? (source.value ?? '').toLowerCase() : (source.value ?? '')
  const candidate = source.key === 'url' ? ctx.url : source.key === 'host' ? ctx.host.toLowerCase() : ctx.path

  switch (source.operator) {
    case 'equals':
      return candidate === value
    case 'contains':
      return candidate.includes(value)
    case 'matches':
      return compileSourceRegex(value)?.test(candidate) ?? false
    case 'wildcard':
      return wildcardToRegex(value).test(candidate)
  }
}

/** 主机名合法字符（含通配 `*` 与 IPv6 的 `:`；已去掉方括号） */
const HOST_CHARS = /^[\w.*:-]+$/

/**
 * 把用户输入归一成「域名 + 端口」（纯函数，后端存盘与前端分组/展示共用）：
 * - `https://www.a.com/35110.html` → `{ host: 'www.a.com' }`（粘 URL 是常见手输，不该变成匹配不上的条目）
 * - `www.a.com:8089` → `{ host: 'www.a.com', port: 8089 }`
 * - `[::1]:8089` / `::1` / `127.0.0.1` 保留 IPv6 / IPv4 主机
 * 解析不出主机（空格、中文、空串）时返回 null，由调用方明确报错。
 */
export function normalizeTargetHostInput(raw: string): { host: string, port?: number } | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  const parsed = parseTargetHostInput(value)
  if (!parsed) return null
  return HOST_CHARS.test(parsed.host) ? parsed : null
}

function parseTargetHostInput(value: string): { host: string, port?: number } | null {
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
  if (hasScheme || value.includes('/') || value.includes('?')) {
    try {
      const url = new URL(hasScheme ? value : `http://${value}`)
      if (!url.hostname) return null
      return { host: url.hostname.toLowerCase(), port: url.port ? Number(url.port) : undefined }
    } catch {
      return null
    }
  }

  // 带方括号的 IPv6（可带端口）：`[::1]` / `[::1]:8089`
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(value)
  if (bracketed?.[1]) return { host: bracketed[1].toLowerCase(), port: bracketed[2] ? Number(bracketed[2]) : undefined }

  // host:port（裸 IPv6 不含方括号，落到下面当纯主机）
  const withPort = /^([^:]+):(\d{1,5})$/.exec(value)
  if (withPort?.[1] && withPort[2]) return { host: withPort[1].toLowerCase(), port: Number(withPort[2]) }

  return { host: value.toLowerCase().replace(/^\[|\]$/g, '') }
}

/**
 * 处理名单条目 = 一个 **origin**（`scheme://host[:port]`）。
 *
 * 名单是**白名单闸门**：只有请求 origin 命中条目，请求才进处理层（拆包 / 记流量）并交给规则；
 * 没命中就整条透传——不动包、不记录、规则一条都不跑。
 * 「这个地址要怎么处理」（改请求 / 改响应 / 重定向 / Mock…）全在规则里，两层不重叠。
 */
export interface InterceptorTarget {
  id: string
  /** 归一后的 origin：`https://www.a.com` / `http://127.0.0.1:8089`（默认端口省略） */
  origin: string
  /** 是否生效（缺省视为启用；禁用 = 该 origin 不进处理层） */
  enabled?: boolean
  /**
   * 强制回源（默认开）：该 origin 的响应去掉缓存控制，浏览器每次都真的发请求，
   * 流量页才看得到重复访问的资源。关掉 = 允许浏览器缓存（重复请求可能不再出现）。
   */
  noCache?: boolean
  createdAt: string
}

const DEFAULT_PORTS: Record<'http' | 'https', number> = { http: 80, https: 443 }

/** 主机名归一：小写；IPv6 补方括号（否则 origin 没法回解析） */
export function normalizeOriginHost(host: string): string {
  const raw = String(host ?? '').trim().toLowerCase()
  if (!raw) return ''
  const bare = raw.replace(/^\[|\]$/g, '')
  return bare.includes(':') ? `[${bare}]` : bare
}

/** 按 origin 语义拼串：默认端口不写（`https://a.com` 与 `https://a.com:443` 是同一个 origin） */
export function originOf(scheme: 'http' | 'https', host: string, port?: number): string {
  const normalizedHost = normalizeOriginHost(host)
  const effective = port ?? DEFAULT_PORTS[scheme]
  return effective === DEFAULT_PORTS[scheme]
    ? `${scheme}://${normalizedHost}`
    : `${scheme}://${normalizedHost}:${effective}`
}

function isLoopbackHostText(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '')
  return bare === 'localhost' || bare === '::1' || /^127\./.test(bare)
}

function isValidOriginHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '')
  if (!bare) return false
  // IPv6 字面量
  if (bare.includes(':')) return /^[0-9a-f:.]+$/.test(bare)
  return /^[a-z0-9.-]+$/.test(bare) && !bare.startsWith('.') && !bare.endsWith('.')
}

/**
 * 用户输入 → origin（纯函数，落盘 / 展示 / 弹窗都用这一份）：
 * - `https://www.a.com/35110.html?x=1` → `https://www.a.com`（粘 URL 只取 origin）
 * - `www.a.com` → `https://www.a.com`（无协议默认 https）
 * - `127.0.0.1:8089` / `localhost:3000` → `http://127.0.0.1:8089`（回环默认 http）
 * - `http://a.com:80` → `http://a.com`（默认端口归一掉）
 * 非 http(s) 协议、含通配符、解析不出主机 → null。
 */
export function parseTargetOrigin(raw: string): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  const explicitScheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value)?.[1]?.toLowerCase()
  if (explicitScheme && explicitScheme !== 'http' && explicitScheme !== 'https') return null
  if (!explicitScheme && value.includes('*')) return null

  let url: URL
  try {
    url = new URL(explicitScheme ? value : `http://${value}`)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (!host || !isValidOriginHost(host)) return null
  const scheme = (explicitScheme ?? (isLoopbackHostText(host) ? 'http' : 'https')) as 'http' | 'https'
  return originOf(scheme, host, url.port ? Number(url.port) : undefined)
}

/** 条目是否命中该 origin（唯一判定：字符串相等 + 条目启用） */
export function targetMatchesOrigin(target: Pick<InterceptorTarget, 'origin' | 'enabled'>, origin: string): boolean {
  return target.enabled !== false && target.origin === origin
}

/** 条目开关的可改字段（渲染层与 command 共用一份） */
export interface InterceptorTargetPatch {
  enabled?: boolean
  noCache?: boolean
}

/** 规则摘要：下发给扩展弹窗（弹窗只做展示与开关，不跑匹配逻辑） */
export interface InterceptorRuleSummary {
  id: string
  name: string
  type: RuleType
  typeLabel: string
  enabled: boolean
  /** 匹配条件的人话摘要，如「URL 包含 /api」 */
  condition: string
  /** 规则的匹配源（扩展本地兜底过滤用；不下发时为纯展示） */
  source?: RuleSource
  /** 域级适用性：global = 规则不绑定具体域（任何站点都可能命中）；site = 与当前站点同域 */
  scope?: 'global' | 'site'
  updatedAt: string
}

// ---------------------------------------------------------------------------
// 规则（v2：按类型对齐 Requestly——一条规则只做一件事，命中多条时按列表顺序
// 叠加。类型：重定向 / URL 替换 / 查询参数 / 取消 / 延迟 / 改头 / UA /
// 请求体 / 响应体·Mock）
// ---------------------------------------------------------------------------

export type RuleType
  = | 'redirect'
    | 'replace'
    | 'queryParam'
    | 'cancel'
    | 'delay'
    | 'headers'
    | 'userAgent'
    | 'request'
    | 'response'
    | 'script'

export const RULE_TYPE_LABELS: Record<RuleType, string> = {
  redirect: '重定向',
  replace: '替换 URL',
  queryParam: '查询参数',
  cancel: '取消请求',
  delay: '延迟',
  headers: '修改请求 / 响应头',
  userAgent: '修改 User-Agent',
  request: '修改请求体',
  response: '修改响应体 / Mock',
  script: '动态脚本',
}

export type RuleSourceKey = 'url' | 'host' | 'path'
export type RuleOperator = 'equals' | 'contains' | 'matches' | 'wildcard'

export interface RuleSource {
  key: RuleSourceKey
  operator: RuleOperator
  value: string
}

/** 资源类型（按 Sec-Fetch-Dest 推断，回退 Accept 启发） */
export type ResourceType
  = | 'main_frame'
    | 'sub_frame'
    | 'script'
    | 'stylesheet'
    | 'image'
    | 'font'
    | 'media'
    | 'xmlhttprequest'
    | 'other'

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  main_frame: '文档',
  sub_frame: '内嵌框架',
  script: '脚本',
  stylesheet: '样式表',
  image: '图片',
  font: '字体',
  media: '音视频',
  xmlhttprequest: 'XHR / Fetch',
  other: '其他',
}

export const REQUEST_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const

export interface RequestPayloadFilter {
  key: string
  operator: 'equals' | 'contains'
  value: string
}

/** 高级过滤器（对齐 Requestly advanced filters） */
export interface RuleFilters {
  requestMethod?: string[]
  resourceType?: ResourceType[]
  /** 页面 URL（取 Referer / Origin，包含匹配，忽略大小写） */
  pageUrl?: string
  /** 请求体过滤（JSON 顶层键 / 表单键 / GraphQL 变量） */
  requestPayload?: RequestPayloadFilter
}

export type HeaderAction = 'add' | 'remove' | 'override'

export interface HeaderOperation {
  id: string
  action: HeaderAction
  name: string
  /** remove 时忽略 */
  value?: string
}

export interface RedirectRuleConfig {
  /** 支持 `$1` 捕获组替换（配合正则 / 通配源） */
  destination: string
  /** 默认 302；307/308 保留方法与体 */
  statusCode?: 301 | 302 | 307 | 308
  /** destination 未带 query 时追加原查询串 */
  preserveQueryParams?: boolean
}

export interface ReplaceRuleConfig {
  from: string
  to: string
}

export type QueryParamAction = 'add' | 'remove' | 'removeAll'

export interface QueryParamModification {
  id: string
  action: QueryParamAction
  param: string
  /** add 时使用 */
  value?: string
  /** add 且参数已存在时的行为（默认 overwrite） */
  actionWhenParamExists?: 'overwrite' | 'ignore'
}

export interface QueryParamRuleConfig {
  modifications: QueryParamModification[]
}

export interface DelayRuleConfig {
  /** 毫秒，上限见 RULE_DELAY_MAX_MS */
  delayMs: number
}

export const RULE_DELAY_MAX_MS = 30_000

export interface HeadersRuleConfig {
  request?: HeaderOperation[]
  response?: HeaderOperation[]
}

export interface UserAgentRuleConfig {
  userAgent: string
}

/** 修改请求体模式：static 静态替换 / code 动态 JS 改写（对齐 Requestly） */
export type RequestBodyMode = 'static' | 'code'

export interface RequestRuleConfig {
  /** 改写模式：缺省视为 static */
  type?: RequestBodyMode
  /** 静态模式为替换文本；动态模式为用户 JS 源码（modifyRequestBody(args)） */
  value?: string
  /** @deprecated 旧版静态替换字段，读兼容；保存时会迁移为 type/value */
  bodyReplace?: string
}

export interface ResponseRuleConfig {
  /** 缺省沿用上游状态码（Mock 时默认 200） */
  statusCode?: number
  statusText?: string
  /** 静态替换响应体 */
  bodyReplace?: string
  /** 不调服务器直接返回（mock）；需 statusCode / bodyReplace 至少其一 */
  mock?: boolean
}

/** 注入世界：MAIN = 页面世界（无扩展 API）；ISOLATED = 扩展隔离世界（userScripts USER_SCRIPT） */
export type ScriptWorld = 'MAIN' | 'ISOLATED'
export type ScriptRunAt = 'document_start' | 'document_end' | 'document_idle'

/** 动态脚本规则：浏览器侧注入执行（不进代理），由 script-compile 编译为 InjectedScript 下发扩展 */
export interface ScriptRuleConfig {
  /** JS 正文；下发时代码外面包一层 source 匹配守卫 */
  code: string
  world: ScriptWorld
  runAt: ScriptRunAt
}

export interface InterceptorRule {
  id: string
  name: string
  /** 可选描述：仅编辑器展示，引擎忽略 */
  description?: string
  enabled: boolean
  /** 钉选：列表「已固定」过滤 + 行首警示色边标识（不影响执行顺序） */
  pinned?: boolean
  type: RuleType
  source: RuleSource
  filters?: RuleFilters
  redirect?: RedirectRuleConfig
  replace?: ReplaceRuleConfig
  queryParam?: QueryParamRuleConfig
  delay?: DelayRuleConfig
  headers?: HeadersRuleConfig
  userAgent?: UserAgentRuleConfig
  request?: RequestRuleConfig
  response?: ResponseRuleConfig
  script?: ScriptRuleConfig
  updatedAt: string
}

// ---------------------------------------------------------------------------
// 注入脚本（脚本正文存 edt，扩展只负责注册执行）
// ---------------------------------------------------------------------------

export interface InjectedScript {
  id: string
  name: string
  enabled: boolean
  /** chrome match patterns，如 `*://*.foo.com/*` */
  matches: string[]
  world: ScriptWorld
  runAt: ScriptRunAt
  code: string
  updatedAt: string
}

// ---------------------------------------------------------------------------
// 流量条目（内存环形缓冲，经 Tauri command 推给渲染层）
// ---------------------------------------------------------------------------

export interface TrafficEntry {
  id: string
  at: number
  method: string
  url: string
  scheme: 'http' | 'https'
  host: string
  path: string
  status?: number
  statusText?: string
  durationMs?: number
  requestHeaders?: Record<string, string>
  requestBody?: string
  responseHeaders?: Record<string, string>
  responseBody?: string
  bodyTruncated?: boolean
  /** mock 短路命中（未请求上游） */
  mocked?: boolean
  /** 被 cancel 规则拦截（连接直接断开） */
  canceled?: boolean
  /** 被 redirect 规则重定向到的地址（本地 30x 响应） */
  redirectedTo?: string
  /** 命中的延迟毫秒（多规则取最后一条） */
  delayedByMs?: number
  /** replace / queryParam 改写后实际发往上游的 URL */
  rewrittenTo?: string
  /** 命中并应用了规则 */
  matchedRuleIds?: string[]
  matchedRuleNames?: string[]
  error?: string
}

// ---------------------------------------------------------------------------
// CA 证书状态
// ---------------------------------------------------------------------------

export type CaPlatform = 'win' | 'mac' | 'unsupported'
export type CaTrustState = 'not-found' | 'installed' | 'trusted' | 'installed-untrusted' | 'error'

export interface CaStatus {
  /** 根证书文件是否已生成（CA 未生成时其余字段无意义） */
  generated: boolean
  platform: CaPlatform
  trustState: CaTrustState
  /** SHA1 指纹（大写十六进制，无分隔），查/删幂等依据 */
  fingerprint: string
  commonName: string
  /** 根证书导出路径（存在时） */
  certPath: string
  /** 详细错误 / 提示（如"已取消授权"） */
  detail?: string
}

// ---------------------------------------------------------------------------
// 运行状态（渲染层展示）
// ---------------------------------------------------------------------------

export interface ExtensionConnectionInfo {
  appId: string
  clientId: string
  version: string
  connectedAt: number
  /** 最近一次上报的代理挂载状态 */
  proxyEnabled: boolean
  proxyError?: string
}

export interface InterceptorRuntimeStatus {
  /** 控制通道端口（扩展自动探测，无需用户填写） */
  wsPort: number | null
  /** 代理端口（浏览器 / 其它工具接入用；首次随机后固定，可手动修改） */
  proxyPort: number | null
  proxyRunning: boolean
  /** 代理端口降级说明（配置端口被占用、已改用随机端口等） */
  proxyPortNote?: string
  connections: ExtensionConnectionInfo[]
  /** 扩展目录（首次安装引导用） */
  extensionDir: string | null
}

/** 修改代理端口的结果（command 返回；status 为改动后的最新运行状态） */
export interface ProxyPortUpdateResult {
  ok: boolean
  error?: string
  status: InterceptorRuntimeStatus
}

// ---------------------------------------------------------------------------
// WS 协议（扩展 ↔ edt）
// ---------------------------------------------------------------------------
// 无配对码：连接只做来源校验（Origin 必须是本扩展），握手即建立会话。
// 端口分工：控制通道端口由扩展在本机端口段内探测；代理端口由 edt 经 hello-ok /
// proxy-port 下发，扩展不硬编码。

export interface WsHelloMessage {
  type: 'hello'
  appId: string
  clientId: string
  version: string
}

export interface WsHelloOkMessage {
  type: 'hello-ok'
  wsPort: number
  proxyPort: number
  targets: InterceptorTarget[]
  scripts: InjectedScript[]
  /** 规则摘要（弹窗按当前站点筛选展示，勾选/移除即回传 edt） */
  rules: InterceptorRuleSummary[]
  /** edt 期望的代理挂载状态（null = 不干预，沿用扩展本地设置） */
  proxyDesired: boolean | null
}

export interface WsHelloRejectMessage {
  type: 'hello-reject'
  reason: 'bad-origin' | 'busy'
}

export interface WsHeartbeatMessage {
  type: 'heartbeat'
  at: number
}

export interface WsPingMessage {
  type: 'ping'
  at: number
}

export interface WsProxyStateMessage {
  type: 'proxy-state'
  enabled: boolean
  error?: string
}

export interface WsTargetsSyncMessage {
  type: 'targets-sync'
  targets: InterceptorTarget[]
}

export interface WsScriptsSyncMessage {
  type: 'scripts-sync'
  scripts: InjectedScript[]
}

export interface WsRulesSyncMessage {
  type: 'rules-sync'
  rules: InterceptorRuleSummary[]
}

/** 代理端口变更（用户在 edt 改端口后下发；扩展需按新端口重新挂载） */
export interface WsProxyPortMessage {
  type: 'proxy-port'
  proxyPort: number
}

export interface WsSetProxyMessage {
  type: 'set-proxy'
  enabled: boolean
}

/** 弹窗把当前标签的 URL 交给 edt：edt 取 origin 后决定加不加进名单 */
export interface WsAddTargetMessage {
  type: 'add-target'
  url: string
}

/** 弹窗里禁用/启用某条名单条目 */
export interface WsTargetToggleMessage {
  type: 'target-toggle'
  id: string
  enabled: boolean
}

/** 弹窗里移除名单条目（按 id 精确删除：同名不同端口 / 含子域变体互不影响） */
export interface WsTargetRemoveByIdMessage {
  type: 'target-remove-id'
  id: string
}

/** 弹窗里禁用/启用某条规则 */
export interface WsRuleToggleMessage {
  type: 'rule-toggle'
  id: string
  enabled: boolean
}

/** 弹窗里删除某条规则 */
export interface WsRuleRemoveMessage {
  type: 'rule-remove'
  id: string
}

/** 弹窗问「当前站点命中了哪些名单条目 / 规则」（匹配逻辑留在 edt，扩展不重复实现） */
export interface WsSiteInfoMessage {
  type: 'site-info'
  requestId: string
  url: string
}

export interface WsSiteInfoResultMessage {
  type: 'site-info-result'
  requestId: string
  /** 命中当前站点的名单条目 */
  targets: InterceptorTarget[]
  /** 与当前站点同域但没命中的条目（弹窗折叠展示：用户能看到自己配的条目为什么没生效） */
  related?: InterceptorTarget[]
  /** 该站点可用的规则（按域筛，site 在前） */
  rules: InterceptorRuleSummary[]
}

export interface WsTargetSuggestMessage {
  type: 'target-suggest'
  requestId: string
  url: string
}

export interface WsTargetSuggestResultMessage {
  type: 'target-suggest-result'
  requestId: string
  hosts: string[]
}

export interface WsScriptLogMessage {
  type: 'script-log'
  scriptId: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export type ExtensionToEdtMessage
  = | WsHelloMessage
    | WsPingMessage
    | WsProxyStateMessage
    | WsAddTargetMessage
    | WsTargetToggleMessage
    | WsTargetRemoveByIdMessage
    | WsRuleToggleMessage
    | WsRuleRemoveMessage
    | WsSiteInfoMessage
    | WsTargetSuggestMessage
    | WsScriptLogMessage

export type EdtToExtensionMessage
  = | WsHelloOkMessage
    | WsHelloRejectMessage
    | WsHeartbeatMessage
    | WsTargetsSyncMessage
    | WsScriptsSyncMessage
    | WsRulesSyncMessage
    | WsProxyPortMessage
    | WsSetProxyMessage
    | WsSiteInfoResultMessage
    | WsTargetSuggestResultMessage
