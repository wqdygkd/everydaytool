import type {
  OfflinePackDownloadProgress,
  OfflinePackDownloadResult,
  OfflinePackDownloadStatus,
} from '../../../../shared/offline-pack.ts'
// 下载目录 + 统一下载任务编排：流式落盘到 data-root/offline-pack/downloads，
// 进度经 broadcastToWindows 推送，支持按 taskId 取消。
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { resolveLayerPath } from '../../../../backend/utils/data-layers.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { OFFLINE_PACK_IPC_CHANNELS } from '../ipc/channels.ts'
import { convertCrxToZip } from './crx.ts'
import { addHistory } from './history.ts'
import { downloadToFile } from './http.ts'

/** 缓存层：下载产物（可重新下载；清缓存会删掉，历史里会显示「文件已缺失」） */
export function getOfflinePackDownloadDir(): string {
  return resolveLayerPath('cache', 'offline-pack', 'downloads')
}

export async function ensureOfflinePackDownloadDir(): Promise<string> {
  const dir = getOfflinePackDownloadDir()
  await mkdir(dir, { recursive: true })
  return dir
}

const activeDownloads = new Map<string, AbortController>()

export function registerActiveDownload(taskId: string, controller: AbortController): void {
  activeDownloads.set(taskId, controller)
}

export function unregisterActiveDownload(taskId: string): void {
  activeDownloads.delete(taskId)
}

export function cancelDownload(taskId: string): boolean {
  const controller = activeDownloads.get(taskId)
  if (!controller) return false
  controller.abort()
  return true
}

/** 退出前取消所有进行中的下载；任务自身的 finally 仍会清理临时文件 */
export function cancelAllDownloads(): void {
  for (const controller of activeDownloads.values()) controller.abort()
  activeDownloads.clear()
}

/** 启动时清扫上次崩溃 / 强退留下的 .part；只处理下载目录内的普通文件 */
export async function sweepOfflinePackTempFiles(): Promise<void> {
  const dir = getOfflinePackDownloadDir()
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.part')) continue
    await rm(path.join(dir, entry.name), { force: true }).catch(() => undefined)
  }
}

const PROGRESS_THROTTLE_MS = 150

interface ProgressThrottle {
  lastEmit: number
  timer: ReturnType<typeof setTimeout> | null
  pending: OfflinePackDownloadProgress | null
}

const progressThrottles = new Map<string, ProgressThrottle>()

function broadcastProgress(progress: OfflinePackDownloadProgress): void {
  broadcastToWindows(OFFLINE_PACK_IPC_CHANNELS.EVENT_PROGRESS, progress, {
    onError: error => logger.warn('OfflinePack progress broadcast failed', { error: error.message }),
  })
}

/**
 * 进度按任务节流到 150ms 一次；下载中的最后一个事件留在 pending 里由定时器补发。
 * 终态 / 阶段切换（processing / completed / error / cancelled）不节流，保证 UI 不会停在旧状态。
 */
export function emitProgress(progress: OfflinePackDownloadProgress): void {
  const now = Date.now()
  let entry = progressThrottles.get(progress.taskId)
  if (!entry) {
    entry = { lastEmit: 0, timer: null, pending: null }
    progressThrottles.set(progress.taskId, entry)
  }

  if (progress.status !== 'downloading') {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    entry.pending = null
    entry.lastEmit = now
    broadcastProgress(progress)
    if (progress.status === 'completed' || progress.status === 'error' || progress.status === 'cancelled') {
      progressThrottles.delete(progress.taskId)
    }
    return
  }

  if (now - entry.lastEmit >= PROGRESS_THROTTLE_MS) {
    entry.lastEmit = now
    broadcastProgress(progress)
    return
  }

  entry.pending = progress
  if (entry.timer) return
  entry.timer = setTimeout(() => {
    entry.timer = null
    const pending = entry.pending
    entry.pending = null
    if (!pending) return
    entry.lastEmit = Date.now()
    broadcastProgress(pending)
  }, Math.max(0, PROGRESS_THROTTLE_MS - (now - entry.lastEmit)))
  entry.timer.unref?.()
}

export interface SimpleDownloadSpec {
  taskId: string
  kind: 'vscode' | 'chrome' | 'edge' | 'msstore' | 'github'
  url: string
  filename: string
  headers?: Record<string, string>
  /** chrome / edge 下载后转 ZIP（最终文件名 .crx → .zip） */
  convertToZip?: boolean
  /** 拒绝 HTML 响应：代理节点用 200 + 网页冒充文件时直接报错，不落盘 */
  rejectHtml?: boolean
  /** 上游提供的 sha256（可带 sha256: 前缀） */
  sha256?: string
}

/** 下载单个 URL 到文件；convertToZip 时先在临时文件落盘再转换，保证失败不留半成品 */
export async function downloadSimpleFile(spec: SimpleDownloadSpec): Promise<OfflinePackDownloadResult> {
  const dir = await ensureOfflinePackDownloadDir()
  const controller = new AbortController()
  activeDownloads.set(spec.taskId, controller)

  const base = path.join(dir, spec.filename)
  const finalPath = spec.convertToZip ? base.replace(/\.crx$/i, '.zip') : base
  // 临时文件带 taskId：同一文件名被两条线路同时下载时，各写各的 .part，不会互相截断
  const tmpPath = `${base}.${spec.taskId.slice(0, 8)}.part`

  const emit = (status: OfflinePackDownloadStatus, downloadedBytes: number, totalBytes: number, message?: string): void => {
    emitProgress({ taskId: spec.taskId, kind: spec.kind, status, downloadedBytes, totalBytes, message })
  }

  try {
    emit('downloading', 0, 0, `正在下载 ${spec.filename}`)
    await downloadToFile(spec.url, tmpPath, {
      headers: spec.headers,
      signal: controller.signal,
      rejectHtml: spec.rejectHtml,
      expectedSha256: spec.sha256,
      onProgress: (downloaded, total) => emit('downloading', downloaded, total, `正在下载 ${spec.filename}`),
    })

    if (spec.convertToZip) {
      emit('processing', 0, 0, '正在转换为 ZIP')
      const crx = await readFile(tmpPath)
      const zip = convertCrxToZip(crx)
      await writeFile(finalPath, zip)
      await rm(tmpPath, { force: true })
    } else {
      await rename(tmpPath, finalPath)
    }

    emit('completed', 0, 0, '下载完成')
    const result = { taskId: spec.taskId, savedPath: finalPath, filename: path.basename(finalPath) }
    await addHistory({ kind: spec.kind, filename: result.filename, savedPath: result.savedPath })
    return result
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    const cancelled = controller.signal.aborted
    emitProgress({
      taskId: spec.taskId,
      kind: spec.kind,
      status: cancelled ? 'cancelled' : 'error',
      downloadedBytes: 0,
      totalBytes: 0,
      error: cancelled ? undefined : error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    activeDownloads.delete(spec.taskId)
  }
}
