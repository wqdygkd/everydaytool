import type { Buffer } from 'node:buffer'
import type {
  OfflinePackDockerManifest,
  OfflinePackDockerPlatform,
  OfflinePackDockerSearchItem,
  OfflinePackDownloadResult,
} from '../../../../shared/offline-pack.ts'
import type { HttpOptions } from '../utils/http.ts'
import { createHash } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'
// Docker Registry 代理：搜索、标签、鉴权、manifest 解析、镜像层下载与 docker load TAR 打包。
// 按 registry 分发端点：ghcr.io / docker.io 走 OCI，均支持加速服务镜像代理；空 registry 默认 Docker Hub。
// 打包在 Node 主进程完成（zlib 解压 + crypto 哈希 + 流式 TAR 写盘），避免浏览器内存/格式限制。
import path from 'node:path'
import { downloadToFile } from '../../../../backend/utils/http-download.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { decompressLayerFile } from '../utils/decompress.ts'
import { emitProgress, ensureOfflinePackDownloadDir, registerActiveDownload, unregisterActiveDownload } from '../utils/downloads.ts'
import { addHistory } from '../utils/history.ts'
import { fetchBuffer, fetchJson, fetchRaw } from '../utils/http.ts'
import { TarWriter } from '../utils/tar-builder.ts'

// 加速服务（如 docker.1panel.live）会对非中国大陆出口返回 “only support mainland China”，
// 这是地域限制而不是镜像/网络故障，翻译成用户能照做的提示。
const MAINLAND_ONLY_PATTERN = /only\s+support\s+(?:mainland\s+china|china\s+mainland)/i
const MAINLAND_ONLY_MESSAGE = '仅面向中国大陆地区，请关闭代理后重试'

function translateDockerError(error: unknown): unknown {
  const err = error as { message?: string, body?: string }
  if (MAINLAND_ONLY_PATTERN.test(`${err.body ?? ''}\n${err.message ?? ''}`)) {
    return new Error(MAINLAND_ONLY_MESSAGE)
  }
  return error
}

/** fetchJson + 加速服务地域限制翻译 */
async function fetchDockerJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  try {
    return await fetchJson<T>(url, options)
  } catch (error) {
    throw translateDockerError(error)
  }
}

const MANIFEST_ACCEPT = [
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.index.v1+json',
].join(', ')

const IMAGE_MANIFEST_ACCEPT = [
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
].join(', ')

interface RegistryConfig {
  /** token 端点（scope 动态拼）；缺省走 Bearer challenge（加速服务 / 未知 registry） */
  tokenUrl?: string
  /** token 请求的 service 参数 */
  tokenService?: string
  /** registry API base（https://registry-1.docker.io / https://ghcr.io / 加速服务基址） */
  registryBase: string
  /** tags 查询模式：hub = Docker Hub 专有 API；registry = OCI /tags/list */
  tagsMode: 'hub' | 'registry'
  /** tagsMode=hub 时的 tags API base */
  hubBase?: string
  /** 加速服务路径前缀：Docker Hub 为空，GHCR / GCR / Quay 等带 `<registry>/`（多库代理靠它区分上游） */
  pathPrefix?: string
}

/** 归一化加速服务基址：补协议、去尾部斜杠；空值返回空串（直连） */
function normalizeMirrorBase(mirror?: string): string {
  if (!mirror) return ''
  const trimmed = mirror.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (/^http:\/\//i.test(trimmed)) throw new Error('Docker 加速地址必须使用 https')
  return /^https:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function assertDigest(buffer: Buffer, expected: string, label: string): void {
  const wanted = expected.replace(/^sha256:/i, '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(wanted)) throw new Error(`${label} digest 非法`)
  const actual = createHash('sha256').update(buffer).digest('hex')
  if (actual !== wanted) {
    throw new Error(`${label}校验失败（sha256 不匹配），镜像可能被篡改或加速线路返回了错误内容`)
  }
}

/** 仓库路径：加速服务时按约定带前缀（docker.io 无前缀，ghcr.io / gcr.io / quay.io 带 `<registry>/`） */
function repoPath(cfg: RegistryConfig, namespace: string, repository: string): string {
  return `${cfg.pathPrefix ?? ''}${namespace}/${repository}`
}

/** registry 只接受 host[:port]，避免把 URL 路径拼进 API 基址 */
function normalizeRegistryHost(registry: string): string {
  const host = registry.trim().replace(/\/+$/, '').toLowerCase()
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) {
    throw new Error(`镜像仓库地址非法：${registry}`)
  }
  return host === 'index.docker.io' || host === 'registry-1.docker.io' ? 'docker.io' : host
}

/**
 * 按 registry 分发端点：
 * - 加速服务统一走 registry v2 端点；
 * - 直连 docker.io 走 Hub 专有 tags API；
 * - ghcr.io 走固定 token 端点；
 * - quay.io / gcr.io / 其它标准 registry 走 `/v2/` 的 Bearer challenge，
 *   不再把未知仓库当成 Docker Hub 去请求同名仓库。
 */
function getRegistryConfig(registry: string, mirror?: string): RegistryConfig {
  const host = normalizeRegistryHost(registry)
  const mirrorBase = normalizeMirrorBase(mirror)
  if (mirrorBase) {
    return {
      registryBase: mirrorBase,
      tagsMode: 'registry',
      pathPrefix: host === 'docker.io' ? '' : `${host}/`,
    }
  }
  if (host === 'ghcr.io') {
    return {
      tokenUrl: 'https://ghcr.io/token',
      tokenService: 'ghcr.io',
      registryBase: 'https://ghcr.io',
      tagsMode: 'registry',
    }
  }
  if (host === 'docker.io') {
    return {
      tokenUrl: 'https://auth.docker.io/token',
      tokenService: 'registry.docker.io',
      registryBase: 'https://registry-1.docker.io',
      tagsMode: 'hub',
      hubBase: 'https://registry.hub.docker.com',
    }
  }
  return {
    registryBase: `https://${host}`,
    tagsMode: 'registry',
  }
}

export async function searchImages(keyword: string, pageSize = 5): Promise<OfflinePackDockerSearchItem[]> {
  const query = encodeURIComponent(keyword.trim())
  const url = `https://hub.docker.com/v2/search/repositories/?query=${query}&page_size=${pageSize}`
  const data = await fetchDockerJson<{ results?: Array<{ repo_name?: string, short_description?: string, star_count?: number, pull_count?: number }> }>(url)
  const results = data.results ?? []
  return results
    .map((item) => {
      const parts = item.repo_name?.split('/') ?? []
      const hasNamespace = parts.length > 1
      return {
        namespace: hasNamespace ? parts[0] : 'library',
        repository: hasNamespace ? parts[1] : (parts[0] ?? ''),
        shortDescription: item.short_description || '',
        starCount: item.star_count || 0,
        pullCount: item.pull_count || 0,
      }
    })
    .filter(item => Boolean(item.repository))
}

export async function getTagList(registry: string, namespace: string, repository: string, mirror?: string): Promise<string[]> {
  const cfg = getRegistryConfig(registry, mirror)
  if (cfg.tagsMode === 'hub') {
    const url = `${cfg.hubBase}/v2/repositories/${namespace}/${repository}/tags?page_size=100`
    logger.debug('offline-pack docker tags 请求', { mode: 'hub', url })
    const data = await fetchDockerJson<{ results?: Array<{ name?: string }> }>(url)
    return (data.results ?? []).map(tag => tag.name ?? '').filter(Boolean)
  }
  // OCI registry：/v2/<repo>/tags/list，需要 token（加速服务可能免鉴权）
  const token = await getToken(registry, namespace, repository, mirror)
  const url = `${cfg.registryBase}/v2/${repoPath(cfg, namespace, repository)}/tags/list`
  logger.debug('offline-pack docker tags 请求', { mode: 'registry', url, authenticated: Boolean(token) })
  const data = await fetchDockerJson<{ tags?: string[] }>(url, { headers: authHeaders(token) })
  return data.tags ?? []
}

/** Bearer 头：加速服务可能免鉴权（空 token），此时不带 Authorization */
function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** 标准 Bearer challenge 鉴权：探测 /v2/，401 时按 WWW-Authenticate 的 realm/service 换 token */
async function acquireTokenViaChallenge(registryBase: string, repoPath: string): Promise<string> {
  const probeUrl = `${registryBase}/v2/`
  const res = await fetchRaw(probeUrl)
  if (res.ok) return ''
  if (res.status !== 401) {
    // 403 多为加速服务 / 网关拒绝匿名探测：响应头与正文都要打出来，才能判断是哪一层拦的
    const body = await res.text().catch(() => '')
    logger.warn('offline-pack 镜像仓库鉴权探测失败', {
      url: probeUrl,
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      wwwAuthenticate: res.headers.get('www-authenticate') ?? '',
      body: body.slice(0, 2000),
    })
    if (MAINLAND_ONLY_PATTERN.test(body)) {
      throw new Error(MAINLAND_ONLY_MESSAGE)
    }
    // 这个探测只用于加速服务（官方 registry 走固定 token 端点）：403 基本是加速服务 / 网关拒绝匿名访问。
    // 响应正文只进日志（上面已打印），不要把 HTML / JSON 原样丢给用户。
    throw new Error(`加速服务拒绝访问（${res.status}），请更换加速服务或检查系统代理`)
  }
  const challenge = res.headers.get('www-authenticate') ?? ''
  logger.debug('offline-pack 镜像仓库鉴权 challenge', { url: probeUrl, challenge })
  const realm = challenge.match(/realm="([^"]+)"/)?.[1]
  if (!realm) throw new Error('加速服务未返回认证信息，请更换加速服务')
  const service = challenge.match(/service="([^"]+)"/)?.[1]
  const params = new URLSearchParams()
  if (service) params.set('service', service)
  params.set('scope', `repository:${repoPath}:pull`)
  const tokenUrl = `${realm}${realm.includes('?') ? '&' : '?'}${params.toString()}`
  logger.debug('offline-pack 请求镜像仓库 token', { url: tokenUrl })
  const data = await fetchDockerJson<{ token?: string, access_token?: string }>(tokenUrl)
  const token = data.token ?? data.access_token
  if (!token) throw new Error('Docker 认证服务未返回 token')
  return token
}

export async function getToken(registry: string, namespace: string, repository: string, mirror?: string): Promise<string> {
  const cfg = getRegistryConfig(registry, mirror)
  const path = repoPath(cfg, namespace, repository)
  if (cfg.tokenUrl) {
    const url = `${cfg.tokenUrl}?service=${cfg.tokenService}&scope=repository:${path}:pull`
    logger.debug('offline-pack 请求官方 registry token', { url })
    const data = await fetchDockerJson<{ token?: string }>(url)
    if (!data.token) throw new Error('Docker 认证服务未返回 token')
    return data.token
  }
  return acquireTokenViaChallenge(cfg.registryBase, path)
}

function buildManifestUrl(registry: string, namespace: string, repository: string, ref: string, mirror?: string): string {
  const cfg = getRegistryConfig(registry, mirror)
  return `${cfg.registryBase}/v2/${repoPath(cfg, namespace, repository)}/manifests/${ref}`
}

function buildLayerUrl(registry: string, namespace: string, repository: string, digest: string, mirror?: string): string {
  const cfg = getRegistryConfig(registry, mirror)
  return `${cfg.registryBase}/v2/${repoPath(cfg, namespace, repository)}/blobs/${digest}`
}

/** 不传 platform：返回可用平台列表（过滤 unknown） */
export async function getPlatforms(registry: string, namespace: string, repository: string, tag: string, token: string, mirror?: string): Promise<OfflinePackDockerPlatform[]> {
  const data = await fetchDockerJson<Record<string, unknown>>(buildManifestUrl(registry, namespace, repository, tag, mirror), {
    headers: { ...authHeaders(token), Accept: MANIFEST_ACCEPT },
  })
  if (!isManifestList(data.mediaType)) return []
  const manifests = (data.manifests ?? []) as Array<Record<string, unknown>>
  return manifests
    .filter((m) => {
      const p = m.platform as Record<string, unknown> | undefined
      return p && p.architecture && p.architecture !== 'unknown' && p.os && p.os !== 'unknown'
    })
    .map((m) => {
      const p = m.platform as Record<string, unknown>
      return {
        architecture: String(p.architecture),
        os: String(p.os),
        variant: typeof p.variant === 'string' ? p.variant : undefined,
        digest: typeof m.digest === 'string' ? m.digest : undefined,
      }
    })
}

function isManifestList(mediaType: unknown): boolean {
  return mediaType === 'application/vnd.docker.distribution.manifest.list.v2+json'
    || mediaType === 'application/vnd.oci.image.index.v1+json'
}

function isPlatformMatch(p: Record<string, unknown> | undefined, targetOs: string, targetArch: string, targetVariant?: string): boolean {
  if (!p || p.os !== targetOs || p.architecture !== targetArch) return false
  if (targetVariant && p.variant !== targetVariant) return false
  if (!targetVariant && targetArch === 'arm' && p.variant) return false
  return true
}

/** 传 platform：从 manifest list 匹配具体平台（精确失败回退忽略 variant），返回归一化 manifest */
export async function getManifest(
  registry: string,
  namespace: string,
  repository: string,
  tag: string,
  token: string,
  platform?: string,
  mirror?: string,
): Promise<OfflinePackDockerManifest> {
  const data = await fetchDockerJson<Record<string, unknown>>(buildManifestUrl(registry, namespace, repository, tag, mirror), {
    headers: { ...authHeaders(token), Accept: MANIFEST_ACCEPT },
  })

  let normalized: OfflinePackDockerManifest
  // 单架构镜像，直接归一化
  if (!isManifestList(data.mediaType)) {
    normalized = normalizeManifest(data)
  } else {
    const manifests = (data.manifests ?? []) as Array<Record<string, unknown>>
    if (!platform) {
      throw new Error('多架构镜像需要指定平台')
    }

    const [targetOs, targetArch, targetVariant] = platform.split('/')
    const matched = manifests.find(m => isPlatformMatch(m.platform as Record<string, unknown> | undefined, targetOs, targetArch, targetVariant))
      ?? manifests.find((m) => {
        const p = m.platform as Record<string, unknown> | undefined
        return p && p.os === targetOs && p.architecture === targetArch
      })

    if (!matched || typeof matched.digest !== 'string') {
      throw new Error(`未找到 ${platform} 平台的镜像`)
    }

    const specific = await fetchDockerJson<Record<string, unknown>>(buildManifestUrl(registry, namespace, repository, matched.digest, mirror), {
      headers: { ...authHeaders(token), Accept: IMAGE_MANIFEST_ACCEPT },
    })
    normalized = normalizeManifest(specific)
  }

  // 提取真实版本号（下载 config blob 解析 OCI Labels / Env）
  normalized.version = await extractImageVersion(registry, namespace, repository, token, normalized.config.digest, mirror)
  return normalized
}

/** 下载镜像 config blob，从 OCI Labels / Env 提取真实版本号 */
async function extractImageVersion(registry: string, namespace: string, repository: string, token: string, configDigest: string, mirror?: string): Promise<string | undefined> {
  if (!configDigest) return undefined
  try {
    const blob = await fetchBuffer(buildLayerUrl(registry, namespace, repository, configDigest, mirror), {
      headers: authHeaders(token),
    })
    const data = JSON.parse(blob.toString('utf8')) as { config?: { Labels?: Record<string, string>, Env?: string[] } }
    const labels = data.config?.Labels ?? {}
    const env = data.config?.Env ?? []
    const ociVersion = labels['org.opencontainers.image.version']
    if (ociVersion) return ociVersion
    if (labels.version) return labels.version
    for (const entry of env) {
      const match = entry.match(/^[A-Z0-9_]+_VERSION=(.+)$/)
      if (match) return match[1]
    }
    return undefined
  } catch {
    return undefined
  }
}

interface ManifestLayer {
  mediaType?: string
  size?: number
  digest?: string
}

interface ImageConfigBlob {
  architecture?: string
  os?: string
  config?: {
    Cmd?: string[] | null
    Entrypoint?: string[] | null
    Env?: string[]
    WorkingDir?: string
  }
  rootfs?: {
    type?: string
    diff_ids?: string[]
  }
}

function normalizeManifest(data: Record<string, unknown>): OfflinePackDockerManifest {
  const rawLayers = Array.isArray(data.layers) ? (data.layers as ManifestLayer[]) : []
  const layers = rawLayers
    .filter((layer): layer is ManifestLayer & { digest: string } => Boolean(layer && typeof layer.digest === 'string' && layer.digest))
    .map(layer => ({
      mediaType: layer.mediaType || 'application/octet-stream',
      size: Number(layer.size) || 0,
      digest: layer.digest,
    }))
  const rawConfig = (data.config ?? {}) as Record<string, unknown>
  return {
    schemaVersion: typeof data.schemaVersion === 'number' ? data.schemaVersion : 2,
    mediaType: typeof data.mediaType === 'string' ? data.mediaType : undefined,
    config: {
      mediaType: typeof rawConfig.mediaType === 'string' ? rawConfig.mediaType : undefined,
      size: Number(rawConfig.size) || 0,
      digest: typeof rawConfig.digest === 'string' ? rawConfig.digest : '',
    },
    layers,
  }
}

export interface DockerDownloadSpec {
  taskId: string
  registry: string
  namespace: string
  repository: string
  tag: string
  platform?: string
  mirror?: string
  filename: string
}

interface ProcessedLayer {
  filePath: string
  size: number
  diffId: string
  layerId: string
}

function generateLayerId(digest: string): string {
  return digest.replace('sha256:', '').substring(0, 12)
}

/** 拉取镜像真实 config blob：Cmd / Entrypoint / Env / WorkingDir / diff_ids 的唯一来源 */
async function fetchImageConfig(
  registry: string,
  namespace: string,
  repository: string,
  token: string,
  configDigest: string,
  mirror?: string,
): Promise<{ buffer: Buffer, config: ImageConfigBlob }> {
  if (!configDigest) throw new Error('镜像清单缺少 config digest，无法导出镜像配置')
  const buffer = await fetchBuffer(buildLayerUrl(registry, namespace, repository, configDigest, mirror), {
    headers: authHeaders(token),
  })
  try {
    const config = JSON.parse(buffer.toString('utf8')) as ImageConfigBlob
    return { buffer, config }
  } catch {
    throw new Error('镜像配置解析失败，加速服务可能返回了错误页面，请更换加速服务后重试')
  }
}

async function packDockerLoadTar(
  destPath: string,
  processed: ProcessedLayer[],
  configBuffer: Buffer,
  configFilename: string,
  namespace: string,
  repository: string,
  tag: string,
): Promise<void> {
  const fullImageName = namespace ? `${namespace}/${repository}` : repository
  const imageTag = `${fullImageName}:${tag}`
  const writer = new TarWriter(destPath)

  await writer.addFile('manifest.json', JSON.stringify([{
    Config: configFilename,
    RepoTags: [imageTag],
    Layers: processed.map(l => `${l.layerId}/layer.tar`),
  }]))

  // 原样写入上游 config blob：手工拼配置会丢 Cmd / Entrypoint / Env / WorkingDir / 端口声明，
  // 加载后 docker run 报 "No command specified"。
  await writer.addFile(configFilename, configBuffer)

  for (let i = 0; i < processed.length; i++) {
    const { filePath, size, layerId } = processed[i]
    await writer.addDirectory(`${layerId}/`)
    await writer.addFile(`${layerId}/VERSION`, '1.0')
    await writer.addFile(`${layerId}/json`, JSON.stringify({
      id: layerId,
      parent: i > 0 ? processed[i - 1].layerId : undefined,
      created: new Date().toISOString(),
      container_config: { Cmd: ['/bin/sh', '-c', '#(nop) ADD file: in /'] },
    }))
    await writer.addFileFromPath(`${layerId}/layer.tar`, filePath, size)
  }

  await writer.end()
}

/** 下载镜像所有层并打包为 docker load TAR，落盘返回路径 */
export async function downloadDockerImage(spec: DockerDownloadSpec): Promise<OfflinePackDownloadResult> {
  const startedAt = Date.now()
  const controller = new AbortController()
  registerActiveDownload(spec.taskId, controller)
  const dir = await ensureOfflinePackDownloadDir()
  const finalPath = path.join(dir, spec.filename)
  const tmpPath = `${finalPath}.${spec.taskId.slice(0, 8)}.part`
  const layerDir = path.join(dir, `.${spec.taskId.slice(0, 8)}-layers`)
  const registry = spec.registry || 'docker.io'
  const namespace = spec.namespace || 'library'
  const { taskId } = spec

  try {
    const token = await getToken(registry, namespace, spec.repository, spec.mirror)
    const manifest = await getManifest(registry, namespace, spec.repository, spec.tag, token, spec.platform, spec.mirror)
    const layers = manifest.layers
    const { buffer: configBuffer, config } = await fetchImageConfig(
      registry,
      namespace,
      spec.repository,
      token,
      manifest.config.digest,
      spec.mirror,
    )
    assertDigest(configBuffer, manifest.config.digest, '镜像配置')
    const expectedDiffIds = config.rootfs?.diff_ids ?? []
    if (expectedDiffIds.length && expectedDiffIds.length !== layers.length) {
      throw new Error(`镜像清单与配置不一致（层数 ${layers.length} / ${expectedDiffIds.length}），请更换加速服务后重试`)
    }
    const configHash = manifest.config.digest.replace(/^sha256:/, '').replace(/[^a-f0-9]/gi, '')
    if (!configHash) throw new Error('镜像清单的 config digest 非法，无法导出镜像配置')
    const configFilename = `${configHash}.json`

    const processed: ProcessedLayer[] = []
    await mkdir(layerDir, { recursive: true })
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      // 每层下载前刷新 token，避免大层下载期间 token 过期（默认 300s）
      const freshToken = await getToken(registry, namespace, spec.repository, spec.mirror)
      emitProgress({
        taskId,
        kind: 'docker',
        status: 'downloading',
        downloadedBytes: 0,
        totalBytes: layer.size,
        layerIndex: i + 1,
        totalLayers: layers.length,
        message: `下载层 ${i + 1}/${layers.length}`,
      })
      const downloadPath = path.join(layerDir, `${i}.${layer.digest.replace(/^sha256:/, '').slice(0, 12)}.download`)
      const layerPath = path.join(layerDir, `${i}.layer.tar`)
      const layerStartedAt = Date.now()
      await downloadToFile(buildLayerUrl(registry, namespace, spec.repository, layer.digest, spec.mirror), downloadPath, {
        headers: authHeaders(freshToken),
        signal: controller.signal,
        expectedSha256: layer.digest,
        onProgress: (downloaded, total) => emitProgress({
          taskId,
          kind: 'docker',
          status: 'downloading',
          downloadedBytes: downloaded,
          totalBytes: total,
          layerIndex: i + 1,
          totalLayers: layers.length,
          message: `下载层 ${i + 1}/${layers.length}`,
        }),
      })
      const { diffId, size } = await decompressLayerFile(downloadPath, layerPath, layer.mediaType)
      await rm(downloadPath, { force: true })
      const expectedDiffId = expectedDiffIds[i]
      if (expectedDiffId && expectedDiffId !== diffId) {
        throw new Error(`第 ${i + 1} 层校验失败（diff_id 不匹配），镜像可能已损坏，请更换加速服务后重新下载`)
      }
      logger.debug('docker layer streamed', {
        layer: i + 1,
        elapsedMs: Date.now() - layerStartedAt,
        unpackedBytes: size,
      })
      processed.push({ filePath: layerPath, size, diffId, layerId: generateLayerId(layer.digest) })
    }

    emitProgress({ taskId, kind: 'docker', status: 'processing', downloadedBytes: 0, totalBytes: 0, message: '正在打包 docker load TAR' })
    await packDockerLoadTar(tmpPath, processed, configBuffer, configFilename, namespace, spec.repository, spec.tag)
    await rename(tmpPath, finalPath)

    emitProgress({ taskId, kind: 'docker', status: 'completed', downloadedBytes: 0, totalBytes: 0, message: '打包完成' })
    const result = { taskId, savedPath: finalPath, filename: spec.filename }
    logger.debug('docker image packed', { elapsedMs: Date.now() - startedAt, layers: layers.length })
    await addHistory({ kind: 'docker', filename: result.filename, savedPath: result.savedPath })
    return result
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    const cancelled = controller.signal.aborted
    emitProgress({
      taskId,
      kind: 'docker',
      status: cancelled ? 'cancelled' : 'error',
      downloadedBytes: 0,
      totalBytes: 0,
      error: cancelled ? undefined : error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    await rm(layerDir, { recursive: true, force: true }).catch(() => {})
    unregisterActiveDownload(spec.taskId)
  }
}
