import type { OfflinePackDownloadKind, OfflinePackHistoryItem } from '../../../../shared/offline-pack.ts'
// 下载历史：落盘记录到配置层 <data>/config/offline-pack/history.json，支持增/查/删/清。
// 删除记录可选连带删除磁盘文件；清空同理。
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { resolveLayerPath, resolveLayerPathWithFallback } from '../../../../backend/utils/data-layers.ts'
import { readJsonFile, removeIfExists, writeJson } from '../../../../backend/utils/file-ops.ts'

const MAX_HISTORY = 200

/** 配置层：下载历史（含 savedPath 记录，不可再生） */
function historyFile(): string {
  return resolveLayerPath('config', 'offline-pack', 'history.json')
}

/** 读取：v2 优先，回查 v1 的 <data>/offline-pack/history.json */
function historyReadFile(): string {
  return resolveLayerPathWithFallback('config', 'offline-pack/history.json')
}

async function readHistory(): Promise<OfflinePackHistoryItem[]> {
  const items = await readJsonFile<OfflinePackHistoryItem[]>(historyReadFile(), [])
  return Array.isArray(items) ? items : []
}

async function writeHistory(items: OfflinePackHistoryItem[]): Promise<void> {
  await writeJson(historyFile(), items)
}

export async function addHistory(entry: { kind: OfflinePackDownloadKind, filename: string, savedPath: string }): Promise<OfflinePackHistoryItem[]> {
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
  const items = await readHistory()
  const next = [item, ...items].slice(0, MAX_HISTORY)
  await writeHistory(next)
  return next
}

/**
 * 列出历史并按磁盘实况回填 `exists` / `size`：
 * 下载产物属于缓存层，清缓存会连文件一起删掉，但历史（配置层）保留——
 * 因此这里必须现算，前端据此显示「文件已缺失」而不是继续展示旧体积。
 */
export async function listHistory(): Promise<OfflinePackHistoryItem[]> {
  const items = await readHistory()
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
  const items = await readHistory()
  const target = items.find(item => item.id === id)
  if (target && deleteFile) {
    await removeIfExists(target.savedPath)
  }
  const next = items.filter(item => item.id !== id)
  await writeHistory(next)
  return next
}

export async function clearHistory(deleteFiles: boolean): Promise<void> {
  if (deleteFiles) {
    const items = await readHistory()
    for (const item of items) {
      await removeIfExists(item.savedPath)
    }
  }
  await writeHistory([])
}
