import type {
  OfflinePackDockerDownloadRequest,
  OfflinePackDownloadRequest,
  OfflinePackSimpleDownloadRequest,
} from '../../../../shared/offline-pack.ts'
// offline-pack 后端 IPC handler：把 5 类上游代理 + 统一下载能力经 safeHandle 暴露给渲染层。
import { ipcMain, shell } from 'electron'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { buildChromeDownloadUrl, CHROME_UA, getChromeDetail, searchChrome } from '../services/chrome-service.ts'
import { downloadDockerImage, getManifest, getPlatforms, getTagList, getToken, searchImages } from '../services/docker-service.ts'
import { buildEdgeDownloadUrl, EDGE_DOWNLOAD_USER_AGENT, getEdgeDetail, searchEdge } from '../services/edge-service.ts'
import { resolveMsStore } from '../services/msstore-service.ts'
import { buildVsCodeLink, queryVsCodeVersions } from '../services/vscode-service.ts'
import { cancelDownload, downloadSimpleFile, ensureOfflinePackDownloadDir } from '../utils/downloads.ts'
import { clearHistory, deleteHistory, listHistory } from '../utils/history.ts'
import { toHttpError } from '../utils/http.ts'
import { OFFLINE_PACK_IPC_CHANNELS } from './channels.ts'

let handlersRegistered = false

/** 统一错误归一：仅上游 HTTP（带 status）与超时错误加可读前缀，业务错误原样透出（保留原始 message 与 cause 链） */
async function guard<T>(fn: () => Promise<T>, prefix: string): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const err = toHttpError(error, prefix)
    if (err.status !== undefined) {
      throw new Error(`${prefix}失败：上游返回 ${err.status}`)
    }
    if (err.isTimeout) throw err
    // 业务错误不经 toHttpError 改写 message，原样抛出
    throw error
  }
}

function sanitizeFilename(filename: unknown): string {
  const base = typeof filename === 'string'
    ? filename.replace(/[\r\n"]/g, '').replace(/[\\/]/g, '_').trim()
    : ''
  return base || 'download.bin'
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}非法`)
  return value.trim()
}

function resolveRegistry(value: unknown): string {
  return typeof value === 'string' && value ? value : 'docker.io'
}

function resolveMirror(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requireNamespace(value: unknown): string {
  if (typeof value !== 'string') throw new Error('namespace非法')
  const ns = value.trim()
  return ns || 'library'
}

export function registerOfflinePackHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  // ---- VSCode ----
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.VSCODE_QUERY, async (_event, url: unknown) => {
    return guard(() => queryVsCodeVersions(requireString(url, '插件 URL')), '查询插件版本')
  })
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.VSCODE_LINK, async (_event, url: unknown, version: unknown) => {
    return buildVsCodeLink(requireString(url, '插件 URL'), requireString(version, '版本号'))
  })

  // ---- Chrome ----
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.CHROME_SEARCH, async (_event, query: unknown) => {
    return guard(() => searchChrome(requireString(query, '搜索关键词')), '搜索 Chrome 扩展')
  })
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.CHROME_DETAIL, async (_event, id: unknown) => {
    return guard(() => getChromeDetail(requireString(id, '扩展 ID')), '获取扩展信息')
  })

  // ---- Edge ----
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.EDGE_SEARCH, async (_event, query: unknown) => {
    return guard(() => searchEdge(requireString(query, '搜索关键词')), '搜索 Edge 扩展')
  })
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.EDGE_DETAIL, async (_event, query: unknown) => {
    return guard(() => getEdgeDetail(requireString(query, '输入内容')), '获取扩展信息')
  })

  // ---- Docker ----
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.DOCKER_SEARCH, async (_event, keyword: unknown) => {
    return guard(() => searchImages(requireString(keyword, '搜索关键词')), '搜索镜像')
  })
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.DOCKER_TAGS, async (_event, registry: unknown, namespace: unknown, repository: unknown, mirror: unknown) => {
    const reg = resolveRegistry(registry)
    return guard(() => getTagList(reg, requireNamespace(namespace), requireString(repository, '仓库名'), resolveMirror(mirror)), '获取标签')
  })
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.DOCKER_PLATFORMS, async (_event, registry: unknown, namespace: unknown, repository: unknown, tag: unknown, mirror: unknown) => {
    const reg = resolveRegistry(registry)
    const ns = requireNamespace(namespace)
    const repo = requireString(repository, '仓库名')
    const refTag = requireString(tag, '标签')
    const mir = resolveMirror(mirror)
    return guard(async () => {
      const token = await getToken(reg, ns, repo, mir)
      return getPlatforms(reg, ns, repo, refTag, token, mir)
    }, '获取可用平台')
  })
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.DOCKER_MANIFEST, async (_event, registry: unknown, namespace: unknown, repository: unknown, tag: unknown, platform: unknown, mirror: unknown) => {
    const reg = resolveRegistry(registry)
    const ns = requireNamespace(namespace)
    const repo = requireString(repository, '仓库名')
    const refTag = requireString(tag, '标签')
    const mir = resolveMirror(mirror)
    return guard(async () => {
      const token = await getToken(reg, ns, repo, mir)
      return getManifest(reg, ns, repo, refTag, token, typeof platform === 'string' && platform ? platform : undefined, mir)
    }, '获取镜像清单')
  })

  // ---- MSStore ----
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.MSSTORE_RESOLVE, async (_event, query: unknown) => {
    return guard(() => resolveMsStore(requireString(query, '输入内容')), '解析应用')
  })

  // ---- 下载 ----
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.DOWNLOAD, async (_event, request: OfflinePackDownloadRequest) => {
    if (!request || typeof request !== 'object') throw new Error('下载参数非法')
    const taskId = requireString(request.taskId, '任务 ID')
    const filename = sanitizeFilename(request.filename)

    if (request.kind === 'docker') {
      const docker = request as OfflinePackDockerDownloadRequest
      return downloadDockerImage({
        taskId,
        registry: resolveRegistry(docker.registry),
        namespace: requireNamespace(docker.namespace),
        repository: requireString(docker.repository, '仓库名'),
        tag: requireString(docker.tag, '标签'),
        platform: typeof docker.platform === 'string' ? docker.platform : undefined,
        mirror: resolveMirror(docker.mirror),
        filename,
      })
    }

    const simple = request as OfflinePackSimpleDownloadRequest
    let url: string
    let headers: Record<string, string> | undefined
    if (simple.kind === 'chrome') {
      url = buildChromeDownloadUrl(requireString(simple.id, '扩展 ID'))
      headers = { 'User-Agent': CHROME_UA }
    } else if (simple.kind === 'edge') {
      url = buildEdgeDownloadUrl(requireString(simple.id, '扩展 ID'))
      headers = { 'User-Agent': EDGE_DOWNLOAD_USER_AGENT }
    } else {
      url = requireString(simple.url, '下载链接')
    }
    if (!/^https?:\/\//i.test(url)) throw new Error('下载链接必须是 http(s)')

    return downloadSimpleFile({
      taskId,
      kind: simple.kind,
      url,
      filename,
      headers,
      convertToZip: simple.convertToZip === true,
    })
  })

  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.CANCEL_DOWNLOAD, async (_event, taskId: unknown) => {
    if (typeof taskId !== 'string') throw new Error('任务 ID 非法')
    return cancelDownload(taskId)
  })

  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.OPEN_DIR, async () => {
    const dir = await ensureOfflinePackDownloadDir()
    const errorMessage = await shell.openPath(dir)
    if (errorMessage) throw new Error(errorMessage)
    return true
  })

  // ---- 下载历史 ----
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.HISTORY_LIST, async () => {
    return listHistory()
  })
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.HISTORY_DELETE, async (_event, id: unknown, deleteFile: unknown) => {
    if (typeof id !== 'string') throw new Error('记录 ID 非法')
    return deleteHistory(id, deleteFile === true)
  })
  safeHandle(ipcMain, OFFLINE_PACK_IPC_CHANNELS.HISTORY_CLEAR, async (_event, deleteFiles: unknown) => {
    await clearHistory(deleteFiles === true)
  })
}
