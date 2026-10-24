import type {
  OfflinePackDockerDownloadRequest,
  OfflinePackDownloadRequest,
  OfflinePackSimpleDownloadRequest,
} from '../../../../shared/offline-pack.ts'
// offline-pack 后端 command handler：把 5 类上游代理 + 统一下载能力经 registerCommand 暴露给渲染层。
import { registerCommand } from '../../../../server/utils/commands.ts'
import { system } from '../../../../server/utils/platform.ts'
import { buildChromeDownloadUrl, CHROME_UA, getChromeDetail, searchChrome } from '../services/chrome-service.ts'
import { downloadDockerImage, getManifest, getPlatforms, getTagList, getToken, searchImages } from '../services/docker-service.ts'
import { buildEdgeDownloadUrl, EDGE_DOWNLOAD_USER_AGENT, getEdgeDetail, searchEdge } from '../services/edge-service.ts'
import { resolveMsStore } from '../services/msstore-service.ts'
import { buildVsCodeLink, queryVsCodeVersions } from '../services/vscode-service.ts'
import { cancelDownload, downloadSimpleFile, ensureOfflinePackDownloadDir } from '../utils/downloads.ts'
import { clearHistory, deleteHistory, listHistory } from '../utils/history.ts'
import { toHttpError } from '../utils/http.ts'
import { OFFLINE_PACK_COMMANDS } from './channels.ts'

let handlersRegistered = false

/** 统一错误归一：上游 HTTP 错误给可读提示，业务错误原样透出 */
async function guard<T>(fn: () => Promise<T>, prefix: string): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const err = toHttpError(error, prefix)
    if (err.status !== undefined) {
      throw new Error(`${prefix}失败：上游返回 ${err.status}`)
    }
    throw err
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

export function registerOfflinePackCommands(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  // ---- VSCode ----
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.VSCODE_QUERY, async (url: unknown) => {
    return guard(() => queryVsCodeVersions(requireString(url, '插件 URL')), '查询插件版本')
  })
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.VSCODE_LINK, async (url: unknown, version: unknown) => {
    return buildVsCodeLink(requireString(url, '插件 URL'), requireString(version, '版本号'))
  })

  // ---- Chrome ----
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.CHROME_SEARCH, async (query: unknown) => {
    return guard(() => searchChrome(requireString(query, '搜索关键词')), '搜索 Chrome 扩展')
  })
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.CHROME_DETAIL, async (id: unknown) => {
    return guard(() => getChromeDetail(requireString(id, '扩展 ID')), '获取扩展信息')
  })

  // ---- Edge ----
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.EDGE_SEARCH, async (query: unknown) => {
    return guard(() => searchEdge(requireString(query, '搜索关键词')), '搜索 Edge 扩展')
  })
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.EDGE_DETAIL, async (query: unknown) => {
    return guard(() => getEdgeDetail(requireString(query, '输入内容')), '获取扩展信息')
  })

  // ---- Docker ----
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.DOCKER_SEARCH, async (keyword: unknown) => {
    return guard(() => searchImages(requireString(keyword, '搜索关键词')), '搜索镜像')
  })
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.DOCKER_TAGS, async (registry: unknown, namespace: unknown, repository: unknown, mirror: unknown) => {
    const reg = resolveRegistry(registry)
    return guard(() => getTagList(reg, requireNamespace(namespace), requireString(repository, '仓库名'), resolveMirror(mirror)), '获取标签')
  })
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.DOCKER_PLATFORMS, async (registry: unknown, namespace: unknown, repository: unknown, tag: unknown, mirror: unknown) => {
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
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.DOCKER_MANIFEST, async (registry: unknown, namespace: unknown, repository: unknown, tag: unknown, platform: unknown, mirror: unknown) => {
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
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.MSSTORE_RESOLVE, async (query: unknown) => {
    return guard(() => resolveMsStore(requireString(query, '输入内容')), '解析应用')
  })

  // ---- 下载 ----
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.DOWNLOAD, async (request: OfflinePackDownloadRequest) => {
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

  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.CANCEL_DOWNLOAD, async (taskId: unknown) => {
    if (typeof taskId !== 'string') throw new Error('任务 ID 非法')
    return cancelDownload(taskId)
  })

  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.OPEN_DIR, async () => {
    const dir = await ensureOfflinePackDownloadDir()
    const errorMessage = await system.openPath(dir)
    if (errorMessage) throw new Error(errorMessage)
    return true
  })

  // ---- 下载历史 ----
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.HISTORY_LIST, async () => {
    return listHistory()
  })
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.HISTORY_DELETE, async (id: unknown, deleteFile: unknown) => {
    if (typeof id !== 'string') throw new Error('记录 ID 非法')
    return deleteHistory(id, deleteFile === true)
  })
  registerCommand('offlinePack', OFFLINE_PACK_COMMANDS.HISTORY_CLEAR, async (deleteFiles: unknown) => {
    await clearHistory(deleteFiles === true)
  })
}
