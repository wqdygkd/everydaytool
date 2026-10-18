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
export type OfflinePackDownloadKind = 'vscode' | 'chrome' | 'edge' | 'docker' | 'msstore'

export interface OfflinePackSimpleDownloadRequest {
  /** 由前端生成的下载任务 ID，用于关联进度推送 */
  taskId: string
  kind: 'vscode' | 'chrome' | 'edge' | 'msstore'
  /** vscode / msstore：直接下载该 URL（chrome / edge 可省略，由后端按 id 构建） */
  url?: string
  /** chrome / edge：扩展 ID，后端据此构建 CRX 下载 URL */
  id?: string
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
}
