// offline-pack 离线包下载域共享类型与纯函数（renderer ↔ 主进程 backend）。
// 仅放纯类型 / 常量 / 纯函数，不依赖 Electron、Node、数据库。

export const OFFLINE_PACK_USER_AGENT = 'Mozilla/5.0 (compatible; offline-pack/1.0)'

// ==================== VSCode ====================
export interface OfflinePackVsCodeQueryResult {
  versions: string[]
}

export interface OfflinePackVsCodeLinkResult {
  downloadUrl: string
}

// ==================== Chrome ====================
export interface OfflinePackChromeSearchItem {
  id: string
  name: string
}

export interface OfflinePackChromeDetail {
  id: string
  name?: string
  description?: string
}

// ==================== Edge ====================
export interface OfflinePackEdgeSearchItem {
  id: string
  storeProductId?: string
  name: string
  developer?: string
  description?: string
  iconUrl?: string
}

export interface OfflinePackEdgeDetail {
  id: string
  storeProductId?: string
  name?: string
  version?: string
  developer?: string
  category?: string
  description?: string
  shortDescription?: string
  rating?: number
  ratingCount?: number
  activeInstallCount?: number
  iconUrl?: string
  isFeatured?: boolean
}

const EDGE_CRX_ID_PATTERN = /^[a-z]{32}$/
const EDGE_STORE_PRODUCT_ID_PATTERN = /^[A-Z0-9]{12}$/i

export type EdgeInput
  = | { type: 'crxId', value: string }
    | { type: 'storeProductId', value: string }

/** 解析 Edge 输入：32 位 CRX ID / 12 位 ProductId / 商店 URL。纯函数，前后端共用。 */
export function parseEdgeQuery(query: string): EdgeInput | null {
  const trimmed = query.trim()
  if (!trimmed) return null

  const lowerValue = trimmed.toLowerCase()
  if (EDGE_CRX_ID_PATTERN.test(lowerValue)) {
    return { type: 'crxId', value: lowerValue }
  }
  if (EDGE_STORE_PRODUCT_ID_PATTERN.test(trimmed)) {
    return { type: 'storeProductId', value: trimmed.toUpperCase() }
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(trimmed)
  } catch {
    try {
      parsedUrl = new URL(`https://${trimmed}`)
    } catch {
      return null
    }
  }

  const urlMatch = parsedUrl.href.toLowerCase().match(/([a-z]{32})/)
  if (urlMatch?.[1]) {
    return { type: 'crxId', value: urlMatch[1] }
  }

  const productId
    = parsedUrl.searchParams.get('productId')
      ?? parsedUrl.searchParams.get('productid')
      ?? parsedUrl.searchParams.get('itemId')
      ?? parsedUrl.searchParams.get('itemid')

  if (productId && EDGE_STORE_PRODUCT_ID_PATTERN.test(productId)) {
    return { type: 'storeProductId', value: productId.toUpperCase() }
  }

  return null
}

// ==================== Docker ====================
export interface OfflinePackDockerImageInfo {
  registry: string
  namespace: string
  repository: string
  tag: string
}

/** 归一化镜像输入：缺失 namespace 补 library、缺失 tag 补 latest。纯函数，前后端共用。 */
export function extractDockerImageInfo(imageUrl: string): OfflinePackDockerImageInfo {
  const cleanUrl = imageUrl.trim()
  const empty: OfflinePackDockerImageInfo = { registry: 'docker.io', namespace: '', repository: '', tag: 'latest' }
  if (!cleanUrl) return empty

  if (cleanUrl.includes('hub.docker.com')) {
    const match = cleanUrl.match(/hub\.docker\.com\/r\/([^/]+)\/([^/?]+)/)
    if (match) {
      const [, namespace, repository] = match
      return { registry: 'docker.io', namespace, repository, tag: 'latest' }
    }
  }

  const parts = cleanUrl.split('/')
  let registry = 'docker.io'
  let namespace = 'library'
  let repoWithTag: string
  if (parts.length === 1) {
    repoWithTag = parts[0]
  } else if (parts.length === 2) {
    namespace = parts[0]
    repoWithTag = parts[1]
  } else {
    registry = parts[0]
    namespace = parts[1]
    repoWithTag = parts[2]
  }
  const [repository, tagPart] = repoWithTag.split(':')
  return { registry, namespace, repository, tag: tagPart || 'latest' }
}

export interface OfflinePackDockerPlatform {
  architecture: string
  os: string
  variant?: string
  digest?: string
}

export interface OfflinePackDockerSearchItem {
  namespace: string
  repository: string
  shortDescription?: string
  starCount?: number
  pullCount?: number
}

export interface OfflinePackDockerManifestLayer {
  mediaType?: string
  size: number
  digest: string
}

export interface OfflinePackDockerManifest {
  schemaVersion: number
  mediaType?: string
  config: { mediaType?: string, size: number, digest: string }
  layers: OfflinePackDockerManifestLayer[]
  /** 从镜像 config 提取的真实版本号（OCI Labels / Env） */
  version?: string
}

// ==================== GitHub ====================
// 仅支持公开仓库：不做 Token / 私有仓库鉴权，API 一律直连（不经加速代理，避免把凭据交给第三方）。
export interface OfflinePackGithubAsset {
  id: number
  name: string
  size: number
  downloadCount: number
  contentType?: string
  /** GitHub 提供的 `sha256:...` 摘要（新发布的资产才有），仅展示不校验 */
  digest?: string
  browserDownloadUrl: string
}

export interface OfflinePackGithubRelease {
  tag: string
  name: string
  publishedAt: string
  prerelease: boolean
  /** 更新日志正文（已截断到合理长度） */
  body?: string
  assets: OfflinePackGithubAsset[]
}

export interface OfflinePackGithubResolveResult extends OfflinePackGithubRepoInfo {
  releases: OfflinePackGithubRelease[]
  /** API 剩余配额（未认证 60 次/小时），0 时前端提示稍后再试 */
  rateRemaining?: number
  /** 配额重置时间（ISO） */
  rateResetAt?: string
}

/** 仓库元信息：解析结果与单文件/源码区共用 */
export interface OfflinePackGithubRepoInfo {
  owner: string
  repo: string
  description?: string
  stars?: number
  language?: string
  defaultBranch: string
  updatedAt?: string
  archived?: boolean
}

/** 分支 / 标签都以 sha 为主键：带 `/` 的 ref 用 sha 寻址才不会歧义 */
export interface OfflinePackGithubRefItem {
  name: string
  sha: string
}

export interface OfflinePackGithubRefsResult {
  branches: OfflinePackGithubRefItem[]
  tags: OfflinePackGithubRefItem[]
  /** 只取到第一页（100 条）：UI 要提示「还有更多」，别让用户以为这就是全部 */
  branchesTruncated?: boolean
  tagsTruncated?: boolean
  rateRemaining?: number
  rateResetAt?: string
}

/** 单文件解析结果（contents API）：只解析路径、大小与下载地址，不落内容 */
export interface OfflinePackGithubFileResult {
  owner: string
  repo: string
  ref: string
  path: string
  name: string
  size: number
  downloadUrl: string
  rateRemaining?: number
  rateResetAt?: string
}

/** GitHub 链接解析结果：`directUrl` 存在时说明本身就是可下载文件，无需走 API */
export interface OfflinePackGithubRef {
  owner: string
  repo: string
  /** releases/tag/<tag> 里的 tag */
  tag?: string
  /** 分支 / 标签 / sha（blob、raw、tree、archive 链接里解析出来） */
  ref?: string
  /** 仓库内文件路径（blob / raw 链接） */
  filePath?: string
  assetName?: string
  directUrl?: string
}

/** 一条加速线路：`base` 为空表示直连（不拼前缀） */
export interface OfflinePackGithubLine {
  id: string
  /** 按钮文案，对齐 gh-proxy 的线路命名，用户一眼能对上 */
  label: string
  base: string
  /** tooltip 里的真实域名 */
  host: string
  recommended?: boolean
}

export interface OfflinePackGithubDownloadVariant {
  id: string
  label: string
  host: string
  recommended: boolean
  /** 该线路下的最终下载链接 */
  url: string
  /** 交给 DOWNLOAD 的加速基址（直连为 undefined） */
  mirror?: string
}

/**
 * 加速线路（拼接式反代）：下载 URL 前拼 `<base>/`，API 请求永远直连。
 * 顺序即按钮顺序；`推荐` 只做视觉标记，不改变默认行为（每个按钮都是一次显式选择）。
 */
export const OFFLINE_PACK_GITHUB_LINES: readonly OfflinePackGithubLine[] = [
  { id: 'ghproxy', label: 'Cloudflare (v4)', base: 'https://gh-proxy.org', host: 'gh-proxy.org' },
  { id: 'v4', label: 'Cloudflare (v4) 优选', base: 'https://v4.gh-proxy.org', host: 'v4.gh-proxy.org', recommended: true },
  { id: 'v6', label: 'Cloudflare (v4/v6)', base: 'https://v6.gh-proxy.org', host: 'v6.gh-proxy.org' },
  { id: 'fastly', label: 'Fastly (v4)', base: 'https://cdn.gh-proxy.org', host: 'cdn.gh-proxy.org' },
  { id: 'axisnow', label: 'AxisNow (v4)', base: 'https://axisnow.gh-proxy.org', host: 'axisnow.gh-proxy.org' },
  { id: 'direct', label: '直连', base: '', host: 'github.com' },
]

/** 加速线路白名单校验：非白名单值一律视为非法，避免后端被当成任意 URL 前缀使用 */
export function normalizeGithubMirror(mirror?: string): string | undefined {
  const value = mirror?.trim().replace(/\/+$/, '') ?? ''
  if (!value) return undefined
  return OFFLINE_PACK_GITHUB_LINES.some(item => item.base === value) ? value : undefined
}

/** 同一个官方链接展开成「每线路一个按钮」所需的全部变体（直连排最后） */
export function githubDownloadVariants(officialUrl: string): OfflinePackGithubDownloadVariant[] {
  return OFFLINE_PACK_GITHUB_LINES.map(line => ({
    id: line.id,
    label: line.label,
    host: line.host,
    recommended: line.recommended === true,
    url: line.base ? `${line.base}/${officialUrl}` : officialUrl,
    mirror: line.base || undefined,
  }))
}

const GITHUB_OWNER_PATTERN = /^[\w.-]+$/
/** GitHub 保留路径，避免把 `releases` / `settings` 之类当成 owner */
const GITHUB_RESERVED = new Set([
  'about',
  'apps',
  'collections',
  'contact',
  'customer-stories',
  'dashboard',
  'docs',
  'explore',
  'features',
  'issues',
  'login',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'pricing',
  'pulls',
  'search',
  'settings',
  'sponsors',
  'topics',
  'trending',
  'users',
])

/** 剥掉拼接式代理前缀：`https://gh-proxy.org/https://github.com/...` → `https://github.com/...` */
function stripGithubProxyPrefix(raw: string): string {
  const trimmed = raw.trim()
  const matched = trimmed.match(/^https?:\/\/[^/]+\/(https?:\/\/.+)$/i)
  const inner = matched?.[1]
  if (inner && /^https?:\/\/(?:www\.)?(?:github\.com|raw\.githubusercontent\.com|codeload\.github\.com)\//i.test(inner)) {
    return inner
  }
  return trimmed
}

/** 路径段解码：非法百分号编码（`%E0%A4%A`）会抛 URIError，这里降级为原串而不是炸掉解析 */
function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** 解析 GitHub 仓库 / Releases / 资产链接；无法识别返回 null。纯函数，前后端共用。 */
export function parseGithubUrl(input: string): OfflinePackGithubRef | null {
  const raw = stripGithubProxyPrefix(input)
  if (!raw) return null

  // 简写 owner/repo（不含协议、恰好一个斜杠）
  if (!/^https?:\/\//i.test(raw) && /^[^/\s]+\/[^/\s]+$/.test(raw)) {
    const [owner, repo] = raw.split('/')
    if (!GITHUB_OWNER_PATTERN.test(owner) || !GITHUB_OWNER_PATTERN.test(repo)) return null
    return { owner, repo: repo.replace(/\.git$/i, '') }
  }

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '')

  // raw 直链：/owner/repo/<ref>/<path>（ref 只取一段，含 `/` 的分支名请粘贴完整 URL）
  if (host === 'raw.githubusercontent.com') {
    const rawSegments = url.pathname.split('/').filter(Boolean).map(safeDecodeSegment)
    const [rawOwner, rawRepo, rawRef, ...rest] = rawSegments
    if (!rawOwner || !rawRepo || !rawRef || !rest.length) return null
    if (!GITHUB_OWNER_PATTERN.test(rawOwner)) return null
    return {
      owner: rawOwner,
      repo: rawRepo.replace(/\.git$/i, ''),
      ref: rawRef,
      filePath: rest.join('/'),
      directUrl: `https://raw.githubusercontent.com${url.pathname}`,
    }
  }

  if (host !== 'github.com') return null

  const segments = url.pathname.split('/').filter(Boolean).map(safeDecodeSegment)
  const [owner, rawRepo] = segments
  const repo = rawRepo?.replace(/\.git$/i, '')
  if (!owner || !repo) return null
  if (!GITHUB_OWNER_PATTERN.test(owner) || !GITHUB_OWNER_PATTERN.test(repo)) return null
  if (GITHUB_RESERVED.has(owner.toLowerCase())) return null
  const [, , section, second, third] = segments
  if (!section) return { owner, repo }

  if (section === 'releases') {
    let tag: string | undefined
    let assetName: string | undefined
    let directUrl: string | undefined
    if (second === 'tag' && third) {
      tag = third
    }
    else if (second === 'download' && third) {
      tag = third
      // 0=owner 1=repo 2=releases 3=download 4=tag 5+=资产文件名
      assetName = segments.slice(5).join('/')
      // 直链直接复用原始 pathname（保留百分号编码），不能用解码后的 assetName 重拼
      if (assetName) directUrl = `https://github.com${url.pathname}`
    }
    else if (second === 'latest' && third === 'download') {
      // 0=owner 1=repo 2=releases 3=latest 4=download 5+=资产文件名
      assetName = segments.slice(5).join('/')
      if (assetName) directUrl = `https://github.com${url.pathname}`
    }
    return { owner, repo, tag, assetName, directUrl }
  }

  // /blob/<ref>/<path>、/raw/<ref>/<path>：单文件（blob 是 HTML 页，直链要换成 raw）
  if (section === 'blob' || section === 'raw') {
    const ref = segments[3]
    const filePath = segments.slice(4).join('/')
    if (!ref) return { owner, repo }
    if (!filePath) return { owner, repo, ref }
    return { owner, repo, ref, filePath, directUrl: githubRawUrl(owner, repo, ref, filePath) }
  }

  // /tree/<ref>：只到分支维度
  if (section === 'tree') {
    return { owner, repo, ref: segments[3] }
  }

  if (section === 'archive') {
    // /archive/refs/tags/v1.2.3.tar.gz 或 /archive/refs/heads/main.zip
    const tail = segments.slice(3).join('/')
    const archive = tail.match(/^refs\/(?:tags|heads)\/(.+)\.(zip|tar\.gz)$/i)
    if (archive) {
      return {
        owner,
        repo,
        tag: archive[1],
        ref: archive[1],
        assetName: segments[segments.length - 1],
        directUrl: `https://github.com${url.pathname}`,
      }
    }
    return { owner, repo }
  }

  // 仓库内的 raw / blob / tree / commit 等页面：只取仓库维度
  return { owner, repo }
}

/** 分支 / 标签源码包：用 sha 走 codeload，避免 `release/1.2` 这类带斜杠的 ref 产生歧义 */
export function githubSourceArchiveUrl(
  owner: string,
  repo: string,
  sha: string,
  format: 'zip' | 'tar.gz',
): string {
  const kind = format === 'zip' ? 'zip' : 'tar.gz'
  return `https://codeload.github.com/${owner}/${repo}/${kind}/${sha}`
}

/** 仓库内单个文件的 raw 直链（ref 逐段编码，路径保持层级） */
export function githubRawUrl(owner: string, repo: string, ref: string, filePath: string): string {
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${encodedPath}`
}

/**
 * 下载前把用户/前端给的地址还原成官方地址：`https://gh-proxy.org/https://github.com/...` → `https://github.com/...`。
 * 校验与下载必须用同一个（还原后的）地址，否则校验过的和实际请求的会是两个 host。
 */
export function unwrapGithubDownloadUrl(raw: string): string {
  return stripGithubProxyPrefix(raw)
}

/**
 * 下载 URL 白名单：release 资产 / 源码归档 / raw 文件（含被代理前缀包裹的形态）。
 * 只放行这三类，避免后端被当成任意 URL 的反代。
 */
export function isAllowedGithubDownloadUrl(raw: string): boolean {
  const unwrapped = unwrapGithubDownloadUrl(raw)
  let url: URL
  try {
    url = new URL(unwrapped)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const path = url.pathname

  if (host === 'github.com') {
    return /^\/[^/]+\/[^/]+\/(?:releases\/(?:download|latest\/download)|archive|raw)\//.test(path)
  }
  if (host === 'raw.githubusercontent.com') {
    return /^\/[^/]+\/[^/]+\/.+/.test(path)
  }
  if (host === 'codeload.github.com') {
    return /^\/[^/]+\/[^/]+\/(?:zip|tar\.gz)\/[^/]+$/.test(path)
  }
  return false
}

/** IPC 入参的仓库标识校验：owner / repo 由渲染层传来，不能直接拼进 URL */
export function isValidGithubOwnerRepo(owner: unknown, repo: unknown): boolean {
  if (typeof owner !== 'string' || typeof repo !== 'string') return false
  if (!owner || !repo || owner.length > 100 || repo.length > 100) return false
  if (!GITHUB_OWNER_PATTERN.test(owner) || !GITHUB_OWNER_PATTERN.test(repo)) return false
  if (GITHUB_RESERVED.has(owner.toLowerCase())) return false
  return !/^\.+$/.test(owner) && !/^\.+$/.test(repo)
}

function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7F) return true
  }
  return false
}

/** 仓库内路径校验：拒绝空段、`.` / `..`、反斜杠与控制字符 */
export function isValidGithubFilePath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  const trimmed = path.trim()
  if (!trimmed || trimmed.length > 1024) return false
  if (hasControlChars(trimmed) || trimmed.includes('\\')) return false
  return trimmed.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

/** 分支 / 标签 / sha 校验：任意非空字符串都可当 ref，但控制字符与反斜杠要挡住 */
export function isValidGithubRefName(ref: unknown): ref is string {
  if (typeof ref !== 'string') return false
  const trimmed = ref.trim()
  if (!trimmed || trimmed.length > 255) return false
  if (trimmed === '.' || trimmed === '..') return false
  return !hasControlChars(trimmed) && !trimmed.includes('\\')
}

// ==================== MSStore ====================
export interface OfflinePackMsStoreFile {
  name: string
  url: string
  expires: string
  sha1: string
  size: string
}

export interface OfflinePackMsStoreResolveResult {
  productId: string
  title: string
  publisherName: string
  description: string
  lastModifiedDate?: string
  packageFamilyNames: string[]
  market: string
  language: string
  categoryId?: string
  files?: OfflinePackMsStoreFile[]
  filesSource?: 'rg-adguard'
  filesError?: string
}

// ==================== 下载任务 ====================
export type OfflinePackDownloadKind = 'vscode' | 'chrome' | 'edge' | 'docker' | 'msstore' | 'github'

export interface OfflinePackSimpleDownloadRequest {
  /** 由前端生成的下载任务 ID，用于关联进度推送 */
  taskId: string
  kind: 'vscode' | 'chrome' | 'edge' | 'msstore' | 'github'
  /** vscode / msstore / github：直接下载该 URL（chrome / edge 可省略，由后端按 id 构建） */
  url?: string
  /** chrome / edge：扩展 ID，后端据此构建 CRX 下载 URL */
  id?: string
  /** github：加速线路基址（白名单校验，缺省直连） */
  mirror?: string
  filename: string
  /** chrome / edge 下载后转 ZIP */
  convertToZip?: boolean
}

export interface OfflinePackDockerDownloadRequest {
  /** 由前端生成的下载任务 ID，用于关联进度推送 */
  taskId: string
  kind: 'docker'
  /** 镜像仓库：ghcr.io / docker.io（缺省 docker.io） */
  registry?: string
  /** Docker registry 加速服务基地址（Docker Hub / GHCR / GCR / Quay，如 https://docker.1ms.run）；缺省直连 */
  mirror?: string
  namespace: string
  repository: string
  tag: string
  /** 平台字符串，如 linux/amd64 */
  platform?: string
  filename: string
}

export type OfflinePackDownloadRequest = OfflinePackSimpleDownloadRequest | OfflinePackDockerDownloadRequest

export type OfflinePackDownloadStatus = 'downloading' | 'processing' | 'completed' | 'error' | 'cancelled'

export interface OfflinePackDownloadProgress {
  taskId: string
  kind: OfflinePackDownloadKind
  status: OfflinePackDownloadStatus
  downloadedBytes: number
  totalBytes: number
  layerIndex?: number
  totalLayers?: number
  message?: string
  error?: string
}

export interface OfflinePackDownloadResult {
  taskId: string
  savedPath: string
  filename: string
}

export interface OfflinePackHistoryItem {
  id: string
  kind: OfflinePackDownloadKind
  filename: string
  savedPath: string
  size: number
  createdAt: string
  /**
   * 磁盘文件是否还在（listHistory 现算）。
   * 下载产物在缓存层，清缓存会删掉它们：历史记录保留，但要能显示「文件已缺失」。
   */
  exists?: boolean
}

// ==================== 展示格式化 ====================
/** 字节数 → 人类可读（B / KB / MB / GB，非整字节保留 1 位小数）。纯函数，前后端 / 各页面共用。 */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

/**
 * 下载文件名清洗：所有来源共用一份规则。
 * `downloads/` 是平铺目录，渲染层负责拼 `${repo}-${tag}-${asset}` 这类前缀，这里只保证
 * 「路径分隔符 / Windows 非法字符 / 控制字符」不会带到磁盘上，并给空值兜底。
 */
export function sanitizeDownloadFilename(filename: unknown): string {
  const raw = typeof filename === 'string' ? filename : ''
  let value = ''
  for (const char of raw) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7F) continue
    value += char
  }
  value = value.replace(/[\\/:*?"<>|]/g, '_').trim()
  // Windows 不允许文件名以点或空格结尾
  value = value.replace(/[.\s]+$/, '')
  if (!value) return 'download.bin'
  if (value.length <= 180) return value
  const dot = value.lastIndexOf('.')
  const ext = dot > 0 && value.length - dot <= 12 ? value.slice(dot) : ''
  return `${value.slice(0, 180 - ext.length)}${ext}`
}

/** ISO 时间 → 本地化时间字符串；缺省 / 非法值返回空串 */
export function formatDateTime(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}
