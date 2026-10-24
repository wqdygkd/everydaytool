import type { OfflinePackDownloadKind, OfflinePackHistoryItem } from '../../../../shared/offline-pack.ts'
// 下载历史：落盘记录到 data-root/offline-pack/history.json，支持增/查/删/清。
// 删除记录可选连带删除磁盘文件；清空同理。
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { getDataDirectory } from '../../../../server/utils/data-root.ts'
import { readJsonFile, removeIfExists, writeJson } from '../../../../server/utils/file-ops.ts'

const MAX_HISTORY = 200

function historyFile(): string {
  return path.join(getDataDirectory(), 'offline-pack', 'history.json')
}

async function readHistory(): Promise<OfflinePackHistoryItem[]> {
  const items = await readJsonFile<OfflinePackHistoryItem[]>(historyFile(), [])
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

export async function listHistory(): Promise<OfflinePackHistoryItem[]> {
  return readHistory()
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
