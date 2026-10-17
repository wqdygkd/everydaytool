// browser-bridge（浏览器桥）共享类型：规则模型 / 处理名单 / 扩展 WS 协议 / 流量条目。
// 纯类型与常量（前端、Electron 主进程共用）；扩展为纯 JS，按同一 JSON 协议通信。
// 设计定稿见 docs/browser-bridge.md。

/** 捆绑扩展的固定 ID：由 manifest.key（公钥）推导，两侧硬编码用于 Origin 校验 */
export const BROWSER_BRIDGE_EXTENSION_ID = 'hlinfcmdeamelkpdemppomgncenalong'

/** 桥控制通道（WS）端口：基准 + 扫描范围（edt 占首个空闲端口，扩展按同段探测） */
export const BRIDGE_WS_PORT_BASE = 59763
export const BRIDGE_WS_PORT_RANGE = 5

/** 代理端口：默认 8080，被占用时顺序探测 */
export const BRIDGE_PROXY_PORT_BASE = 8080
export const BRIDGE_PROXY_PORT_RANGE = 10

/** 流量条目请求/响应体落内存与下发的截断上限（字符） */
export const TRAFFIC_BODY_MAX_CHARS = 64 * 1024
/** 流量环形缓冲条数上限（v1 只存内存，不落库） */
export const TRAFFIC_RING_SIZE = 1000

// ---------------------------------------------------------------------------
// 处理名单（edt 处理层过滤器：谁被拆包/改包/记日志）
// ---------------------------------------------------------------------------

export type TargetMatchType = 'exact' | 'suffix' | 'regex'

export interface BridgeTarget {
  id: string
  /** exact: `api.foo.com` / `127.0.0.1`；suffix: `foo.com`（命中本体与任意子域）；regex: 对 host 匹配 */
  host: string
  /** 回环等显式端口目标必须带端口，避免圈进本机所有服务 */
  port?: number
  matchType: TargetMatchType
  createdAt: string
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

export interface BridgeRule {
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
// 流量条目（内存环形缓冲，经 IPC 推给渲染层）
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
// 桥状态（渲染层展示）
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

export interface BridgeRuntimeStatus {
  wsPort: number | null
  proxyPort: number | null
  proxyRunning: boolean
  connections: ExtensionConnectionInfo[]
  /** 扩展目录（首次安装引导用） */
  extensionDir: string | null
  /** 配对 token（展示给用户填入扩展） */
  token: string
}

// ---------------------------------------------------------------------------
// WS 协议（扩展 ↔ edt）
// ---------------------------------------------------------------------------

export interface WsHelloMessage {
  type: 'hello'
  token: string
  appId: string
  clientId: string
  version: string
}

export interface WsHelloOkMessage {
  type: 'hello-ok'
  wsPort: number
  proxyPort: number
  targets: BridgeTarget[]
  scripts: InjectedScript[]
  /** edt 期望的代理挂载状态（null = 不干预，沿用扩展本地设置） */
  proxyDesired: boolean | null
}

export interface WsHelloRejectMessage {
  type: 'hello-reject'
  reason: 'bad-token' | 'bad-origin' | 'busy'
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
  targets: BridgeTarget[]
}

export interface WsScriptsSyncMessage {
  type: 'scripts-sync'
  scripts: InjectedScript[]
}

export interface WsSetProxyMessage {
  type: 'set-proxy'
  enabled: boolean
}

export interface WsAddTargetMessage {
  type: 'add-target'
  url: string
  matchType: TargetMatchType
}

export interface WsRemoveTargetMessage {
  type: 'remove-target'
  host: string
  port?: number
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
    | WsRemoveTargetMessage
    | WsTargetSuggestMessage
    | WsScriptLogMessage

export type EdtToExtensionMessage
  = | WsHelloOkMessage
    | WsHelloRejectMessage
    | WsHeartbeatMessage
    | WsTargetsSyncMessage
    | WsScriptsSyncMessage
    | WsSetProxyMessage
    | WsTargetSuggestResultMessage
