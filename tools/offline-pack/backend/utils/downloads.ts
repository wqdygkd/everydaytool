import type {
  OfflinePackDownloadProgress,
  OfflinePackDownloadResult,
  OfflinePackDownloadStatus,
} from '../../../../shared/offline-pack.ts'
// 下载目录 + 统一下载任务编排：流式落盘到 data-root/offline-pack/downloads，
// 进度经 broadcastToWindows 推送，支持按 taskId 取消。
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { getDataDirectory } from '../../../../backend/utils/data-root.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { OFFLINE_PACK_IPC_CHANNELS } from '../ipc/channels.ts'
import { convertCrxToZip } from './crx.ts'
import { addHistory } from './history.ts'
import { downloadToFile } from './http.ts'

export function getOfflinePackDownloadDir(): string {
  return path.join(getDataDirectory(), 'offline-pack', 'downloads')
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

export function emitProgress(progress: OfflinePackDownloadProgress): void {
  broadcastToWindows(OFFLINE_PACK_IPC_CHANNELS.EVENT_PROGRESS, progress, {
    onError: error => logger.warn('OfflinePack progress broadcast failed', { error: error.message }),
  })
}

export interface SimpleDownloadSpec {
  taskId: string
  kind: 'vscode' | 'chrome' | 'edge' | 'msstore'
  url: string
  filename: string
  headers?: Record<string, string>
  /** chrome / edge 下载后转 ZIP（最终文件名 .crx → .zip） */
  convertToZip?: boolean
}

/** 下载单个 URL 到文件；convertToZip 时先在临时文件落盘再转换，保证失败不留半成品 */
export async function downloadSimpleFile(spec: SimpleDownloadSpec): Promise<OfflinePackDownloadResult> {
  const dir = await ensureOfflinePackDownloadDir()
  const controller = new AbortController()
  activeDownloads.set(spec.taskId, controller)

  const base = path.join(dir, spec.filename)
  const finalPath = spec.convertToZip ? base.replace(/\.crx$/i, '.zip') : base
  const tmpPath = `${base}.part`

  const emit = (status: OfflinePackDownloadStatus, downloadedBytes: number, totalBytes: number, message?: string): void => {
    emitProgress({ taskId: spec.taskId, kind: spec.kind, status, downloadedBytes, totalBytes, message })
  }

  try {
    emit('downloading', 0, 0, `正在下载 ${spec.filename}`)
    await downloadToFile(spec.url, tmpPath, {
      headers: spec.headers,
      signal: controller.signal,
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
