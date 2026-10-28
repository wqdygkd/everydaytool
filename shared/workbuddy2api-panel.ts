/** workbuddy2api-panel 共享类型 / 常量 / 纯函数（不依赖 Electron / Node）。 */

export const WB2API_TOOL_ID = 'workbuddy2api-panel' as const

/** 上游仓库（资产下载与 release API 仅限此 repo） */
export const WB2API_GITHUB_OWNER = 'misakano7545'
export const WB2API_GITHUB_REPO = 'workbuddy2api-panel'
export const WB2API_GITHUB_REPO_SLUG = `${WB2API_GITHUB_OWNER}/${WB2API_GITHUB_REPO}`

/** 探活身份字段；503 + 正确 service ≠ 进程挂 */
export const WB2API_HEALTH_SERVICE = 'workbuddy2api'

export const WB2API_DEFAULT_PORT = 7863
export const WB2API_BINARY_NAME = 'wb2api'
export const WB2API_BINARY_NAME_WIN = 'wb2api.exe'

export type Wb2apiOsKey = 'darwin' | 'linux' | 'windows'
export type Wb2apiArchKey = 'amd64' | 'arm64'

export type Wb2apiRuntimeStatus
  = | 'not_installed'
    | 'stopped'
    | 'running'
    | 'running_empty'
    | 'unhealthy'
    | 'updating'
    | 'error'

export type Wb2apiInstallSource = 'github' | 'local-file'

export interface Wb2apiManifest {
  version: string
  tag: string
  os: Wb2apiOsKey
  arch: Wb2apiArchKey
  assetName: string
  digest: string
  source: Wb2apiInstallSource
  installedAt: string
}

export interface Wb2apiAppSettings {
  /** 用户偏好端口；START 时强制写入 listen=127.0.0.1:<port> */
  port: number
}

export interface Wb2apiHealthSnapshot {
  ok: boolean
  statusCode: number | null
  service: string | null
  healthy: number | null
  total: number | null
  error: string | null
}

export interface Wb2apiProgressEvent {
  phase: 'download' | 'verify' | 'extract' | 'promote' | 'rollback' | 'done' | 'error' | 'cancelled'
  downloadedBytes: number
  totalBytes: number
  message?: string
  error?: string
}

export interface Wb2apiUpdateInfo {
  currentVersion: string | null
  latestVersion: string
  latestTag: string
  assetName: string
  digest: string
  downloadUrl: string
  hasUpdate: boolean
}

/**
 * 最近一次「检查更新」拿到的上游 release 快照（主进程内存缓存，重开页签仍在）。
 * 只缓存上游那一半：**已安装版本不缓存**——它随时可能被本地 ZIP 装成别的版本，
 * 只能按 manifest 现算，否则会拿着过期结论误报「可更新 / 已最新」。
 */
export interface Wb2apiReleaseSnapshot {
  latestVersion: string
  latestTag: string
  assetName: string
  digest: string
  downloadUrl: string
  /** 检查时间（ISO）；仅用于展示「什么时候查的」，不参与比较 */
  checkedAt: string
}

export interface Wb2apiPanelState {
  status: Wb2apiRuntimeStatus
  version: string | null
  port: number
  panelUrl: string | null
  /** run/config.json 的 api_key；未安装或未写入时为 null */
  apiKey: string | null
  lastError: string | null
  installed: boolean
  orphanLikely: boolean
  updating: boolean
  progress: Wb2apiProgressEvent | null
  /** 最近一次检查更新的结果（由缓存的 release 快照 + 当前 manifest 版本现算）；从未检查过为 null */
  update: Wb2apiUpdateInfo | null
}

export function defaultWb2apiAppSettings(): Wb2apiAppSettings {
  return { port: WB2API_DEFAULT_PORT }
}

export function defaultWb2apiPanelState(): Wb2apiPanelState {
  return {
    status: 'not_installed',
    version: null,
    port: WB2API_DEFAULT_PORT,
    panelUrl: null,
    apiKey: null,
    lastError: null,
    installed: false,
    orphanLikely: false,
    updating: false,
    progress: null,
    update: null,
  }
}

/** 快照 + 当前已安装版本 → 面板展示用的检查结果（hasUpdate 永远按最新事实重算） */
export function buildWb2apiUpdateInfo(
  snapshot: Wb2apiReleaseSnapshot,
  currentVersion: string | null,
): Wb2apiUpdateInfo {
  return {
    currentVersion,
    latestVersion: snapshot.latestVersion,
    latestTag: snapshot.latestTag,
    assetName: snapshot.assetName,
    digest: snapshot.digest,
    downloadUrl: snapshot.downloadUrl,
    hasUpdate: currentVersion !== snapshot.latestVersion,
  }
}

/** Node `process.platform` → 上游资产 os 段 */
export function mapNodePlatformToWb2apiOs(platform: NodeJS.Platform | string): Wb2apiOsKey | null {
  if (platform === 'darwin') return 'darwin'
  if (platform === 'linux') return 'linux'
  if (platform === 'win32') return 'windows'
  return null
}

/** Node `process.arch` → 上游资产 arch 段（x64→amd64） */
export function mapNodeArchToWb2apiArch(arch: string): Wb2apiArchKey | null {
  if (arch === 'x64' || arch === 'amd64') return 'amd64'
  if (arch === 'arm64') return 'arm64'
  return null
}

/**
 * 上游资产名：`wb2api-panel-${VERSION}-{darwin|linux|windows}-{amd64|arm64}.zip`
 * VERSION 不含 `v` 前缀；tag = `v${VERSION}`。
 */
export function buildWb2apiAssetName(version: string, os: Wb2apiOsKey, arch: Wb2apiArchKey): string {
  const ver = version.replace(/^v/, '')
  return `wb2api-panel-${ver}-${os}-${arch}.zip`
}

export function wb2apiTagFromVersion(version: string): string {
  const ver = version.replace(/^v/, '')
  return `v${ver}`
}

export function wb2apiVersionFromTag(tag: string): string {
  return tag.replace(/^v/, '')
}

export function buildWb2apiPanelUrl(port: number): string {
  return `http://127.0.0.1:${port}/panel/`
}

/** OpenAI 兼容客户端的 base URL（/v1/chat/completions、/v1/models） */
export function buildWb2apiOpenAiBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`
}

/** Anthropic Messages 客户端的 base URL（/v1/messages） */
export function buildWb2apiAnthropicBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

export function buildWb2apiHealthzUrl(port: number): string {
  return `http://127.0.0.1:${port}/healthz`
}

/** 下载 URL 白名单：仅该 GitHub repo / api */
export function isAllowedWb2apiDownloadUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    const path = url.pathname
    if (host === 'api.github.com') {
      return path.startsWith(`/repos/${WB2API_GITHUB_REPO_SLUG}/`)
    }
    if (host === 'github.com') {
      return path.startsWith(`/${WB2API_GITHUB_REPO_SLUG}/`)
    }
    // release asset CDN
    if (host === 'objects.githubusercontent.com' || host.endsWith('.githubusercontent.com')) {
      return true
    }
    return false
  } catch {
    return false
  }
}

export function parseListenPort(listen: unknown, fallback = WB2API_DEFAULT_PORT): number {
  if (typeof listen !== 'string' || !listen.trim()) return fallback
  const trimmed = listen.trim()
  // ":7863" | "127.0.0.1:7863" | "7863"
  const m = trimmed.match(/:(\d+)\s*$/) || trimmed.match(/^(\d+)\s*$/)
  if (!m) return fallback
  const port = Number(m[1])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback
  return port
}

export function forceLocalListen(port: number): string {
  return `127.0.0.1:${port}`
}

/** 状态文案（右栏） */
export function wb2apiStatusLabel(status: Wb2apiRuntimeStatus): string {
  switch (status) {
    case 'not_installed': return '未安装'
    case 'stopped': return '已停止'
    case 'running': return '运行中'
    case 'running_empty': return '运行中（无可用账号）'
    case 'unhealthy': return '异常'
    case 'updating': return '更新中'
    case 'error': return '错误'
    default: return status
  }
}
