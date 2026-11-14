import type { OfflinePackDownloadKind, OfflinePackHistoryItem } from '../../../../shared/offline-pack.ts'
// 下载历史：落盘记录到配置层 <data>/config/offline-pack/history.json，支持增/查/删/清。
// 删除记录可选连带删除磁盘文件；清空同理。
import { randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import { resolveLayerPath, resolveLayerPathWithFallback } from '../../../../backend/utils/data-layers.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { resolvePathInside } from './history-path.ts'

const MAX_HISTORY = 200

/** 配置层：下载历史（含 savedPath 记录，不可再生） */
function historyFile(): string {
  return resolveLayerPath('config', 'offline-pack', 'history.json')
}

/** 读取：v2 优先，回查 v1 的 <data>/offline-pack/history.json */
function historyReadFile(): string {
  return resolveLayerPathWithFallback('config', 'offline-pack/history.json')
}

function readHistory(): OfflinePackHistoryItem[] {
  const items = readJsonDocument<unknown>(historyReadFile(), () => [])
  return Array.isArray(items)
    ? items.filter((item): item is OfflinePackHistoryItem =>
        Boolean(item) && typeof item === 'object' && typeof (item as OfflinePackHistoryItem).id === 'string')
    : []
}

function writeHistory(items: OfflinePackHistoryItem[]): void {
  writeJsonDocument(historyFile(), items)
}

let historyQueue: Promise<void> = Promise.resolve()

/** 历史读改写必须串行：add / delete / clear 之间只要隔一次 await 就会互相覆盖 */
async function withHistoryLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = historyQueue
  let release!: () => void
  historyQueue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await task()
  } finally {
    release()
  }
}

/** 只允许删除下载目录内的普通文件；记录里的路径不可信 */
function resolveDeletableFile(savedPath: string): string | null {
  return resolvePathInside(resolveLayerPath('cache', 'offline-pack', 'downloads'), savedPath)
}

async function removeDownloadedFile(savedPath: string): Promise<void> {
  const target = resolveDeletableFile(savedPath)
  if (!target) {
    logger.warn('Refused to delete offline-pack history file outside downloads directory', {
      savedPath,
    })
    return
  }
  try {
    const info = await stat(target)
    if (!info.isFile()) return
    await rm(target, { force: true })
  } catch {
    // 文件已不存在 / 无权限：历史记录仍照常移除
  }
}

export async function addHistory(entry: { kind: OfflinePackDownloadKind, filename: string, savedPath: string }): Promise<OfflinePackHistoryItem[]> {
  return withHistoryLock(async () => {
    let size = 0
    try {
      size = (await stat(entry.savedPath)).size
    } catch {
      // 文件可能已被删除，大小记 0
    }
    const item: OfflinePackHistoryItem = {
      id: randomUUID(),
      kind: entry.kind,
      filename: entry.filename,
      savedPath: entry.savedPath,
      size,
      createdAt: new Date().toISOString(),
    }
    const next = [item, ...readHistory()].slice(0, MAX_HISTORY)
    writeHistory(next)
    return next
  })
}

/**
 * 列出历史并按磁盘实况回填 `exists` / `size`：
 * 下载产物属于缓存层，清缓存会连文件一起删掉，但历史（配置层）保留——
 * 因此这里必须现算，前端据此显示「文件已缺失」而不是继续展示旧体积。
 */
export async function listHistory(): Promise<OfflinePackHistoryItem[]> {
  const items = readHistory()
  return Promise.all(items.map(async (item) => {
    try {
      const info = await stat(item.savedPath)
      return { ...item, size: info.size, exists: true }
    } catch {
      return { ...item, exists: false }
    }
  }))
}

export async function deleteHistory(id: string, deleteFile: boolean): Promise<OfflinePackHistoryItem[]> {
  return withHistoryLock(async () => {
    const items = readHistory()
    const target = items.find(item => item.id === id)
    if (target && deleteFile) await removeDownloadedFile(target.savedPath)
    const next = items.filter(item => item.id !== id)
    writeHistory(next)
    return next
  })
}

export async function clearHistory(deleteFiles: boolean): Promise<void> {
  await withHistoryLock(async () => {
    if (deleteFiles) {
      for (const item of readHistory()) {
        await removeDownloadedFile(item.savedPath)
      }
    }
    writeHistory([])
  })
}
