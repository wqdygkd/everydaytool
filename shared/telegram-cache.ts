// telegram-cache / tweb-cache 共享的归档契约、类型与常量：
// 纯类型 / 常量 / 纯函数，前端与 Electron 主进程共用。
// 覆盖方案文档 M0（被动观测）+ M1（资源索引 / 任务去重）+ M2（HTTP 缓存语义 / 配额淘汰 /
// 受控的本地响应复用，默认关闭）+ M3（页面捕获）+ 可选 M3-B（MTProto 下载，需 .env 凭据）。
// 设计见 docs/telegram-cache.md。

/** 默认承载的 Telegram Web A 地址（用户可在页面内返回首页，导航由主进程 allowlist 约束） */
export const TELEGRAM_DEFAULT_URL = 'https://web.telegram.org/a/'

/** 资源清单 / 最近请求 / 任务历史的内存上限（主进程与渲染层共用同一组数字） */
export const TELEGRAM_RESOURCE_LIMIT = 300
export const TELEGRAM_TRAFFIC_LIMIT = 300
export const TELEGRAM_TASK_HISTORY_LIMIT = 50

/** 归档状态推送通道：按工具 scope 分流，避免两个影库互相收到对方的事件 */
export const TELEGRAM_ARCHIVE_LIBRARY_EVENT_CHANNEL = 'telegram-cache:event:library'
export const TWEB_ARCHIVE_LIBRARY_EVENT_CHANNEL = 'tweb-cache:event:library'

/** 单资源大小上限的允许区间（配置层做 clamp，避免误填 4GB / 0） */
export const TELEGRAM_MIN_RESOURCE_BYTES = 1024 * 1024
export const TELEGRAM_MAX_RESOURCE_BYTES = 2 * 1024 * 1024 * 1024
/** 默认上限 512MB：足够覆盖 Telegram 单文件媒体，又不至于一次点错拖垮磁盘 */
export const TELEGRAM_DEFAULT_RESOURCE_BYTES = 512 * 1024 * 1024

/** HTTP 并发池上限（MTProto 池本版本不启用） */
export const TELEGRAM_MIN_HTTP_CONCURRENCY = 1
export const TELEGRAM_MAX_HTTP_CONCURRENCY = 8
export const TELEGRAM_DEFAULT_HTTP_CONCURRENCY = 3

/** 单个任务的最大尝试次数（含首次）；4xx 等不可重试错误不消耗尝试次数 */
export const TELEGRAM_TASK_MAX_ATTEMPTS = 3

/** 缓存配额区间与默认值（M2：LRU 淘汰按此上限执行，归档副本不在此配额内） */
export const TELEGRAM_MIN_CACHE_BYTES = 256 * 1024 * 1024
export const TELEGRAM_MAX_CACHE_BYTES = 20 * 1024 * 1024 * 1024
export const TELEGRAM_DEFAULT_CACHE_BYTES = 3 * 1024 * 1024 * 1024

// 站点端口必须**确定性**：页面 origin 含端口，而登录凭据（localStorage 里的 GramJS auth key）、
// IndexedDB、Cache Storage、Service Worker 注册都按 origin 隔离 —— 每次启动换端口等于每次重新登录 + 缓存归零。
// 从 BASE 起在 RANGE 内直接 bind，撞上占用才顺延；实际端口由主进程落盘到配置的 sitePort。
// 选 34100 起：避开 5173 / 8080 等常用端口，也避开 Windows 的 49152+ 临时端口段。
export const TELEGRAM_SITE_PORT_BASE = 34100
export const TELEGRAM_SITE_PORT_RANGE = 16
export const TELEGRAM_SITE_PORT_MIN = 1024
export const TELEGRAM_SITE_PORT_MAX = 65535

/** 图片类资源的 MIME 前缀（本地响应默认只做图片；音视频走单区间 Range，见 localMediaRangeEnabled） */
export const TELEGRAM_LOCAL_RESPONSE_MIME_PREFIX = 'image/'

/** Chromium 的 resourceType 子集（与本工具统计口径一致） */
export type TelegramResourceType
  = | 'mainFrame'
    | 'subFrame'
    | 'stylesheet'
    | 'script'
    | 'image'
    | 'font'
    | 'object'
    | 'xhr'
    | 'ping'
    | 'cspReport'
    | 'media'
    | 'webSocket'
    | 'other'

export type TelegramTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

/** 消费者意图：cache = 存入资源库 */
export type TelegramResourceKind = 'cache'

export type TelegramCompleteness = 'unknown' | 'partial' | 'complete'
export type TelegramVerification = 'unverified' | 'verified'

/** 本地响应类别：none = 永不复用；image = 图片整份；media = 音视频（单区间 206） */
export type TelegramServeClass = 'none' | 'image' | 'media'

export interface TelegramCacheConfig {
  /** 观测开关：关闭后仍保持 webRequest 挂载，但不再记录（可快速重开） */
  observationEnabled: boolean
  maxHttpConcurrency: number
  maxResourceBytes: number
  /** 缓存配额：超过后按 LRU 淘汰（归档副本不受影响） */
  cacheMaxBytes: number
  /** 站点端口：落盘后固定，保证 origin 不随重启变化；null = 还没分配过 */
  sitePort: number | null
}

export const TELEGRAM_DEFAULT_CONFIG: TelegramCacheConfig = {
  observationEnabled: true,
  maxHttpConcurrency: TELEGRAM_DEFAULT_HTTP_CONCURRENCY,
  maxResourceBytes: TELEGRAM_DEFAULT_RESOURCE_BYTES,
  cacheMaxBytes: TELEGRAM_DEFAULT_CACHE_BYTES,
  sitePort: null,
}

/**
 * 能力矩阵：明确区分「可观测 / 可捕获 / 不可访问」。
 * telegramDownloader 表示独立 MTProto 下载能力是否已具备（实现需要 .env 凭据与会话，
 * 运行时状态见 TelegramMtprotoStatus）；UI 文案以该字段与 status 为准。
 */
export interface TelegramCapabilities {
  /** webRequest 已挂载在该分区 session 上（只观测、不改写） */
  httpObservation: boolean
  /** 响应大小只能从 content-length 等响应头推导，不是真实计量 */
  httpHeaderBytes: boolean
  /** 独立 MTProto 下载器（已实现，但需要 .env 凭据与会话；见 status） */
  telegramDownloader: boolean
  /** 能否在 guest 页面里执行只读探测脚本 */
  guestProbe: boolean
  /** 存储形态：只保存校验过的内容文件 + 按 HTTP 语义判定能否本地响应 */
  persistence: 'verified-content-store'
  notes: string[]
}

export interface TelegramResourceTypeStat {
  resourceType: TelegramResourceType
  requests: number
  bytes: number
}

export interface TelegramHostStat {
  host: string
  requests: number
  bytes: number
}

export interface TelegramObservationStats {
  enabled: boolean
  observingSince: number | null
  requests: number
  completed: number
  failed: number
  /** Chromium 判定为来自磁盘缓存的完成数（观测口径，不等于省流量） */
  fromCache: number
  /** 可观测网络接收字节：仅统计「非缓存命中 + 有 content-length」的响应 */
  networkBytes: number
  /** 有响应头但缺少 content-length 的完成数（大小未知，不计入 networkBytes） */
  unknownSizeCount: number
  cacheHitRate: number | null
  byType: TelegramResourceTypeStat[]
  byHost: TelegramHostStat[]
}

export interface TelegramTrafficEntry {
  id: number
  at: number
  method: string
  host: string
  /** 已脱敏的路径 + 查询参数名（值一律替换为 ***） */
  path: string
  resourceType: TelegramResourceType
  statusCode?: number
  fromCache: boolean
  bytes?: number
  durationMs?: number
  mimeType?: string
  error?: string
}

export interface TelegramStoredInfo {
  size: number
  sha256: string
  completeness: TelegramCompleteness
  verification: TelegramVerification
  relativePath: string
  updatedAt: number
  /** 允许作为本地响应复用（图片 / 音视频 + 新鲜 + 未声明 no-store/private/no-cache + Vary 可接受） */
  cacheable: boolean
  /** 可用的本地响应类别；none = 不本地复用 */
  serveClass: TelegramServeClass
  /** 计入缓存配额（no-store 内容只为归档保留，不占缓存配额、不参与 LRU） */
  quotaManaged: boolean
  freshUntil: number | null
  cacheControl?: string
  etag?: string
}

/** M2 缓存运行时统计：命中 / 服务字节 / 淘汰量 / 条件验证。命中字节 ≠ 节省的网络字节（还需基准对比） */
export interface TelegramCacheRuntimeStats {
  sizeBytes: number
  entryCount: number
  maxBytes: number
  servedBytes: number
  localHits: number
  localMisses: number
  /** 过期条目发出的条件验证次数（If-None-Match / If-Modified-Since） */
  revalidations: number
  /** 条件验证返回 304 的次数（可继续用本地内容） */
  revalidationHits: number
  evictedBytes: number
  evictions: number
  lastEvictionAt: number | null
  localResponseEnabled: boolean
  localMediaRangeEnabled: boolean
  handlerInstalled: boolean
  /** M3 路径 A：页面已下载字节的捕获状态与计量 */
  pageCaptureEnabled: boolean
  pageCaptureAttached: boolean
  pageCapturedBytes: number
  pageCaptureHits: number
  pageCaptureMisses: number
}

// ---------------------------------------------------------------------------
// M2 基准测试：用「可观测网络字节」的区间差值验证流量变化
// ---------------------------------------------------------------------------

export interface TelegramBenchmarkCounters {
  requests: number
  completed: number
  failed: number
  fromCache: number
  networkBytes: number
  unknownSizeCount: number
  cacheServedBytes: number
  localHits: number
  localMisses: number
  revalidations: number
  revalidationHits: number
  pageCapturedBytes: number
}

export interface TelegramBenchmarkRecord extends TelegramBenchmarkCounters {
  id: string
  label: string
  startedAt: number
  endedAt: number
  durationMs: number
  networkBytesPerRequest: number | null
  /** 观测在测试期间被清空 / 回绕时记一条说明，避免把无效样本当结论 */
  note?: string
}

export interface TelegramBenchmarkStatus {
  active: {
    id: string
    label: string
    startedAt: number
    snapshot: TelegramBenchmarkCounters
  } | null
  records: TelegramBenchmarkRecord[]
}

// ---------------------------------------------------------------------------
// M3-B：MTProto 消息媒体下载（可选，凭据只从主进程 .env 读取）
// ---------------------------------------------------------------------------

export type TelegramMtprotoPhase
  = | 'idle'
    | 'resolving'
    | 'downloading'
    | 'verifying'
    | 'completed'
    | 'failed'
    | 'cancelled'

export interface TelegramMtprotoAccount {
  id: string
  username?: string
  firstName?: string
}

export interface TelegramMtprotoTask {
  taskId: string
  phase: TelegramMtprotoPhase
  link: string
  messageId?: number
  fileName?: string
  mimeType?: string
  bytes: number
  totalBytes: number | null
  /** 本次从已提交偏移继续的字节数（0 = 从头下载） */
  resumedFrom: number
  sha256?: string
  error?: string
  startedAt: number
  updatedAt: number
}

export interface TelegramMtprotoStatus {
  configured: boolean
  hasSession: boolean
  connected: boolean
  account: TelegramMtprotoAccount | null
  missing: string[]
  /** MTProto 库（teleproto）版本 */
  libVersion: string | null
  /** 会话来源：OS 加密存储（safeStorage）/ .env 明文 / 缺失 */
  sessionSource: 'secure' | 'env' | 'none'
  /** 当前平台是否支持 Electron safeStorage */
  encryptionAvailable: boolean
  error?: string
  active: TelegramMtprotoTask | null
  /** 最近一次已结束的任务（完成后 active 会清空，这里保留结果供 UI 展示） */
  lastTask: TelegramMtprotoTask | null
}

/** MTProto 路径的进度 / 状态推送（EVENT_MTPROTO） */
export type TelegramMtprotoEvent = TelegramMtprotoStatus

export interface TelegramResourceSummary {
  resourceKey: string
  /** 脱敏展示地址：查询参数值全部隐藏 */
  displayUrl: string
  host: string
  path: string
  resourceType: TelegramResourceType
  mimeType?: string
  size: number
  sizeKnown: boolean
  requests: number
  fromCache: boolean
  statusCode?: number
  lastSeenAt: number
  /** 是否可在本次会话内按已观测地址取回（blob:/data: 等一律 false） */
  downloadable: boolean
  stored?: TelegramStoredInfo
}

export interface TelegramTaskSnapshot {
  taskId: string
  resourceKey: string
  displayUrl: string
  host: string
  status: TelegramTaskStatus
  priority: number
  /** 当前仍挂在该任务上的消费者数 */
  consumers: number
  /** 累计加入过该任务的消费者数（含已取消）；>1 说明发生过 single-flight 合并 */
  joinedConsumers: number
  kinds: TelegramResourceKind[]
  bytes: number
  totalBytes: number | null
  attempts: number
  error?: string
  queuedAt: number
  startedAt?: number
  finishedAt?: number
}

export interface TelegramSelfTestStep {
  name: string
  ok: boolean
  detail: string
}

export interface TelegramSelfTestResult {
  ok: boolean
  steps: TelegramSelfTestStep[]
  ranAt: number
}

export interface TelegramPageProbe {
  ok: boolean
  probedAt: number
  url: string
  title: string
  /** guest 的 UA（截断）：用于判断目标站点是否为受支持浏览器 */
  userAgent: string
  visible: boolean
  videoCount: number
  audioCount: number
  mediaElementCount: number
  /** 页面 performance 里出现的 blob: 资源条数（说明媒体可能由页面自行拼装） */
  blobUrlCount: number
  serviceWorkerActive: boolean
  storageEstimateSupported: boolean
  performance: {
    resources: number
    transferSize: number
    decodedBodySize: number
    initiatorTypes: Record<string, number>
  }
  findings: string[]
  error?: string
}

export interface TelegramDiagnosticsExport {
  relativePath: string
  bytes: number
  exportedAt: number
  /** 诊断包内包含的条目数（资源 / 请求 / 任务） */
  counts: {
    resources: number
    traffic: number
    tasks: number
  }
}

export interface TelegramWebSessionInfo {
  /** Web A 的 Chromium 分区实际目录 */
  directory: string
  inDataDirectory: boolean
  /** 数据目录运行期切换后，重启才会迁移分区 */
  restartRequired: boolean
  error?: string
}

/** 自托管 telegram-tt 的站点状态（v4）：页面与 /api、/media 同源 */
export interface TelegramSiteInfo {
  ready: boolean
  /** 形如 http://127.0.0.1:<port>/；未就绪时 null */
  url: string | null
  /** 当前实际端口；未就绪时 null */
  port: number | null
  /** 上次落盘的端口（诊断 origin 是否变化用） */
  previousPort: number | null
  /**
   * 上次落盘端口与实际端口不一致 → origin 已变，页面侧的登录态 / IndexedDB / Cache Storage /
   * Service Worker 注册全部作废（都需要重新登录），UI 必须明确提示。
   */
  originChanged: boolean
  /** origin 变化时给出的说明（写入失败/端口被占用等），否则 null */
  portNote: string | null
  error: string | null
}

// ---------------------------------------------------------------------------
// 消息级缓存（v4）：messages/peer-<群 id>/<消息 id>/message.md + media/<mediaKey>.<ext>
// ---------------------------------------------------------------------------

export type TelegramMessageState = 'missing' | 'queued' | 'downloading' | 'partial' | 'complete' | 'failed'
export type TelegramAttachmentState = 'pending' | 'partial' | 'complete' | 'failed'
export type TelegramMediaLinkMode = 'hardlink' | 'copy' | 'object'

export interface TelegramMessagePeerSnapshot {
  id: string
  username?: string
  titleSnapshot?: string
  type?: string
}

export interface TelegramForwardSourceSnapshot {
  id?: string
  titleSnapshot?: string
  username?: string
  name?: string
  messageId?: number
  date?: string
}

export interface TelegramThumbnailSnapshot {
  mediaKey: string
  mimeType: string
  size: number
  relativePath: string
  savedAt: number
}

export interface TelegramMessageAttachment {
  index: number
  mediaKey: string
  kind: string
  mimeType?: string
  fileName?: string
  expectedSize?: number
  actualSize?: number
  sha256?: string
  /** 相对工具命名空间（assets 层）的路径，如 `messages/peer-<peerId>/<mid>/media/<mediaKey>.jpg` */
  relativePath?: string
  linkMode?: TelegramMediaLinkMode
  status: TelegramAttachmentState
}

export interface TelegramMessageManifest {
  schemaVersion: 1
  messageKey: string
  peer: TelegramMessagePeerSnapshot
  messageId: number
  groupedId?: string
  date?: string
  editDate?: string
  senderSnapshot?: { id?: string, name?: string }
  forwardSource?: TelegramForwardSourceSnapshot
  thumbnail?: TelegramThumbnailSnapshot
  text?: { saved: boolean, chars: number, truncated?: boolean, file?: string }
  status: TelegramMessageState
  attachments: TelegramMessageAttachment[]
  origin?: { reachable?: boolean, lastCheckedAt?: number }
  savedAt: number
  updatedAt: number
}

export interface TelegramArchivePrepareAttachment {
  index: number
  mediaKey: string
  kind: string
  mimeType?: string
  fileName?: string
  expectedSize?: number
}

export interface TelegramArchivePrepareRequest {
  peer: TelegramMessagePeerSnapshot
  messageId: number
  groupedId?: string
  date?: string
  editDate?: string
  sender?: { id?: string, name?: string }
  forwardSource?: TelegramForwardSourceSnapshot
  /** 正文（提前送来，进行中的目录也能读出内容） */
  text?: string
  textTruncated?: boolean
  attachments: TelegramArchivePrepareAttachment[]
}

export interface TelegramArchiveAttachmentProgress {
  index: number
  mediaKey: string
  received: number
  expected: number
  complete: boolean
}

export interface TelegramArchivePrepareResponse {
  state: TelegramMessageState
  attachments: TelegramArchiveAttachmentProgress[]
  thumbnailSaved?: boolean
}

export interface TelegramArchiveAppendResponse {
  received: number
  expected: number
  complete: boolean
}

export interface TelegramArchiveCommitRequest {
  peer: TelegramMessagePeerSnapshot
  messageId: number
  text?: string
  textTruncated?: boolean
}

export interface TelegramMessageStatusEntry {
  state: TelegramMessageState
  received?: number
  expected?: number
  progress?: number
  attachments?: number
  savedAt?: number
  error?: string
}

export interface TelegramLibraryEntry {
  peerId: string
  messageId: number
  state: TelegramMessageState
  peerTitle?: string
  senderName?: string
  forwardSource?: TelegramForwardSourceSnapshot
  groupedId?: string
  thumbnailMediaKey?: string
  thumbnailUrl?: string
  savedAt?: number
  size: number
  attachmentCount: number
  /** 0..1；进行中（partial/queued）才有意义 */
  progress?: number
  textPreview?: string
  /** 可在 Telegram 里定位该消息的链接（展示/复制用；点击走内嵌页面跳转） */
  messageLink: string
  /** 消息目录的绝对路径（「打开文件夹」与提示用） */
  localDir: string
  /** 相对 assets 根的消息目录 */
  relativeDir: string
}

/** 主进程 → 渲染层的影库状态推送（一次一条消息，进度变化会连续推送） */
export interface TelegramLibraryEvent {
  peerId: string
  messageId: number
  state: TelegramMessageState
  received?: number
  expected?: number
  progress?: number
}

export interface TelegramTrashEntry {
  trashId: string
  deletedAt: number
  expiresAt: number
  originalPath: string
  peerId: string
  messageId: number
}

export interface TelegramSnapshot {
  stats: TelegramObservationStats
  cache: TelegramCacheRuntimeStats
  resources: TelegramResourceSummary[]
  tasks: TelegramTaskSnapshot[]
  capabilities: TelegramCapabilities
  config: TelegramCacheConfig
  dataDirectory: string
  /** Telegram Web A 登录缓存（Chromium 分区）位置 */
  webSession: TelegramWebSessionInfo
  site: TelegramSiteInfo
  generatedAt: number
}
