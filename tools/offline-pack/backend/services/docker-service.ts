import type { Buffer } from 'node:buffer'
import type {
  OfflinePackDockerManifest,
  OfflinePackDockerPlatform,
  OfflinePackDockerSearchItem,
  OfflinePackDownloadResult,
} from '../../../../shared/offline-pack.ts'
import { rename, rm } from 'node:fs/promises'
// Docker Registry 代理：搜索、标签、鉴权、manifest 解析、镜像层下载与 docker load TAR 打包。
// 按 registry 分发端点：ghcr.io 走 OCI 端点，其余（docker.io / 空）走 Docker Hub。
// 打包在 Node 主进程完成（zlib 解压 + crypto 哈希 + 流式 TAR 写盘），避免浏览器内存/格式限制。
import path from 'node:path'
import { decompressLayer } from '../utils/decompress.ts'
import { emitProgress, ensureOfflinePackDownloadDir, registerActiveDownload, unregisterActiveDownload } from '../utils/downloads.ts'
import { addHistory } from '../utils/history.ts'
import { fetchBuffer, fetchJson } from '../utils/http.ts'
import { TarWriter } from '../utils/tar-builder.ts'

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
  /** token 端点（scope 动态拼） */
  tokenUrl: string
  /** token 请求的 service 参数 */
  tokenService: string
  /** registry API base（https://registry-1.docker.io / https://ghcr.io） */
  registryBase: string
  /** tags 查询模式：hub = Docker Hub 专有 API；registry = OCI /tags/list */
  tagsMode: 'hub' | 'registry'
  /** tagsMode=hub 时的 tags API base */
  hubBase?: string
}

/** 按 registry 分发端点；ghcr.io 走 OCI，其余默认 Docker Hub */
function getRegistryConfig(registry: string): RegistryConfig {
  if (registry === 'ghcr.io') {
    return {
      tokenUrl: 'https://ghcr.io/token',
      tokenService: 'ghcr.io',
      registryBase: 'https://ghcr.io',
      tagsMode: 'registry',
    }
  }
  return {
    tokenUrl: 'https://auth.docker.io/token',
    tokenService: 'registry.docker.io',
    registryBase: 'https://registry-1.docker.io',
    tagsMode: 'hub',
    hubBase: 'https://registry.hub.docker.com',
  }
}

export async function searchImages(keyword: string, pageSize = 5): Promise<OfflinePackDockerSearchItem[]> {
  const query = encodeURIComponent(keyword.trim())
  const url = `https://hub.docker.com/v2/search/repositories/?query=${query}&page_size=${pageSize}`
  const data = await fetchJson<{ results?: Array<{ repo_name?: string, short_description?: string, star_count?: number, pull_count?: number }> }>(url)
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

export async function getTagList(registry: string, namespace: string, repository: string): Promise<string[]> {
  const cfg = getRegistryConfig(registry)
  if (cfg.tagsMode === 'hub') {
    const url = `${cfg.hubBase}/v2/repositories/${namespace}/${repository}/tags?page_size=100`
    const data = await fetchJson<{ results?: Array<{ name?: string }> }>(url)
    return (data.results ?? []).map(tag => tag.name ?? '').filter(Boolean)
  }
  // OCI registry：/v2/<repo>/tags/list，需要 token
  const token = await getToken(registry, namespace, repository)
  const url = `${cfg.registryBase}/v2/${namespace}/${repository}/tags/list`
  const data = await fetchJson<{ tags?: string[] }>(url, { headers: { Authorization: `Bearer ${token}` } })
  return data.tags ?? []
}

export async function getToken(registry: string, namespace: string, repository: string): Promise<string> {
  const cfg = getRegistryConfig(registry)
  const repoPath = `${namespace}/${repository}`
  const url = `${cfg.tokenUrl}?service=${cfg.tokenService}&scope=repository:${repoPath}:pull`
  const data = await fetchJson<{ token?: string }>(url)
  if (!data.token) throw new Error('Docker 认证服务未返回 token')
  return data.token
}

function buildManifestUrl(registry: string, namespace: string, repository: string, ref: string): string {
  const cfg = getRegistryConfig(registry)
  return `${cfg.registryBase}/v2/${namespace}/${repository}/manifests/${ref}`
}

function buildLayerUrl(registry: string, namespace: string, repository: string, digest: string): string {
  const cfg = getRegistryConfig(registry)
  return `${cfg.registryBase}/v2/${namespace}/${repository}/blobs/${digest}`
}

/** 不传 platform：返回可用平台列表（过滤 unknown） */
export async function getPlatforms(registry: string, namespace: string, repository: string, tag: string, token: string): Promise<OfflinePackDockerPlatform[]> {
  const data = await fetchJson<Record<string, unknown>>(buildManifestUrl(registry, namespace, repository, tag), {
    headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT },
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
): Promise<OfflinePackDockerManifest> {
  const data = await fetchJson<Record<string, unknown>>(buildManifestUrl(registry, namespace, repository, tag), {
    headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT },
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

    const specific = await fetchJson<Record<string, unknown>>(buildManifestUrl(registry, namespace, repository, matched.digest), {
      headers: { Authorization: `Bearer ${token}`, Accept: IMAGE_MANIFEST_ACCEPT },
    })
    normalized = normalizeManifest(specific)
  }

  // 提取真实版本号（下载 config blob 解析 OCI Labels / Env）
  normalized.version = await extractImageVersion(registry, namespace, repository, token, normalized.config.digest)
  return normalized
}

/** 下载镜像 config blob，从 OCI Labels / Env 提取真实版本号 */
async function extractImageVersion(registry: string, namespace: string, repository: string, token: string, configDigest: string): Promise<string | undefined> {
  if (!configDigest) return undefined
  try {
    const blob = await fetchBuffer(buildLayerUrl(registry, namespace, repository, configDigest), {
      headers: { Authorization: `Bearer ${token}` },
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
  filename: string
}

interface ProcessedLayer {
  data: Buffer
  diffId: string
  layerId: string
}

function generateLayerId(digest: string): string {
  return digest.replace('sha256:', '').substring(0, 12)
}

function generateImageId(imageTag: string): string {
  let hash = 0
  for (let i = 0; i < imageTag.length; i++) {
    hash = ((hash << 5) - hash) + imageTag.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(12, '0')
}

async function packDockerLoadTar(
  destPath: string,
  manifest: OfflinePackDockerManifest,
  processed: ProcessedLayer[],
  namespace: string,
  repository: string,
  tag: string,
  platform?: string,
): Promise<void> {
  const fullImageName = namespace ? `${namespace}/${repository}` : repository
  const imageTag = `${fullImageName}:${tag}`
  const imageId = generateImageId(imageTag)
  const writer = new TarWriter(destPath)

  await writer.addFile('manifest.json', JSON.stringify([{
    Config: `${imageId}.json`,
    RepoTags: [imageTag],
    Layers: processed.map(l => `${l.layerId}/layer.tar`),
  }]))

  const architecture = platform?.split('/')[1] || 'amd64'
  const configJson = {
    architecture,
    config: {
      Hostname: '',
      Domainname: '',
      User: '',
      AttachStdin: false,
      AttachStdout: false,
      AttachStderr: false,
      Tty: false,
      OpenStdin: false,
      StdinOnce: false,
      Env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
      Cmd: null,
      Image: '',
      Volumes: null,
      WorkingDir: '',
      Entrypoint: null,
      OnBuild: null,
      Labels: null,
    },
    container_config: {
      Hostname: '',
      Domainname: '',
      User: '',
      AttachStdin: false,
      AttachStdout: false,
      AttachStderr: false,
      Tty: false,
      OpenStdin: false,
      StdinOnce: false,
      Env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
      Cmd: ['/bin/sh', '-c', '#(nop) ADD file: in /'],
      Image: '',
      Volumes: null,
      WorkingDir: '',
      Entrypoint: null,
      OnBuild: null,
      Labels: {},
    },
    created: new Date().toISOString(),
    docker_version: '20.10.0',
    history: manifest.layers.map(() => ({
      created: new Date().toISOString(),
      created_by: '/bin/sh -c #(nop) ADD file: in /',
    })),
    os: 'linux',
    rootfs: { type: 'layers', diff_ids: processed.map(l => l.diffId) },
  }
  await writer.addFile(`${imageId}.json`, JSON.stringify(configJson))

  for (let i = 0; i < processed.length; i++) {
    const { data, layerId } = processed[i]
    await writer.addDirectory(`${layerId}/`)
    await writer.addFile(`${layerId}/VERSION`, '1.0')
    await writer.addFile(`${layerId}/json`, JSON.stringify({
      id: layerId,
      parent: i > 0 ? processed[i - 1].layerId : undefined,
      created: new Date().toISOString(),
      container_config: { Cmd: ['/bin/sh', '-c', '#(nop) ADD file: in /'] },
    }))
    await writer.addFile(`${layerId}/layer.tar`, data)
  }

  await writer.end()
}

/** 下载镜像所有层并打包为 docker load TAR，落盘返回路径 */
export async function downloadDockerImage(spec: DockerDownloadSpec): Promise<OfflinePackDownloadResult> {
  const controller = new AbortController()
  registerActiveDownload(spec.taskId, controller)
  const dir = await ensureOfflinePackDownloadDir()
  const finalPath = path.join(dir, spec.filename)
  const tmpPath = `${finalPath}.part`
  const registry = spec.registry || 'docker.io'
  const namespace = spec.namespace || 'library'
  const { taskId } = spec

  try {
    const token = await getToken(registry, namespace, spec.repository)
    const manifest = await getManifest(registry, namespace, spec.repository, spec.tag, token, spec.platform)
    const layers = manifest.layers

    const processed: ProcessedLayer[] = []
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      // 每层下载前刷新 token，避免大层下载期间 token 过期（默认 300s）
      const freshToken = await getToken(registry, namespace, spec.repository)
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
      const blob = await fetchBuffer(buildLayerUrl(registry, namespace, spec.repository, layer.digest), {
        headers: { Authorization: `Bearer ${freshToken}` },
        signal: controller.signal,
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
      const { data, diffId } = decompressLayer(blob, layer.mediaType)
      processed.push({ data, diffId, layerId: generateLayerId(layer.digest) })
    }

    emitProgress({ taskId, kind: 'docker', status: 'processing', downloadedBytes: 0, totalBytes: 0, message: '正在打包 docker load TAR' })
    await packDockerLoadTar(tmpPath, manifest, processed, namespace, spec.repository, spec.tag, spec.platform)
    await rename(tmpPath, finalPath)

    emitProgress({ taskId, kind: 'docker', status: 'completed', downloadedBytes: 0, totalBytes: 0, message: '打包完成' })
    const result = { taskId, savedPath: finalPath, filename: spec.filename }
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
    unregisterActiveDownload(spec.taskId)
  }
}
