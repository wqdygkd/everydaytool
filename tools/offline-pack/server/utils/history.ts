import type { OfflinePackDownloadKind, OfflinePackHistoryItem } from '../../../../shared/offline-pack.ts'
// 下载历史：落盘记录到 data-root/offline-pack/history.json，支持增/查/删/清。
// 删除记录可选连带删除磁盘文件；清空同理。
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { getDataDirectory } from '../../../../server/utils/data-root.ts'
import { removeIfExists } from '../../../../server/utils/file-ops.ts'
import { JsonFileStore } from '../../../../server/utils/json-store.ts'

const MAX_HISTORY = 200

const store = new JsonFileStore<OfflinePackHistoryItem[]>(
  () => path.join(getDataDirectory(), 'offline-pack', 'history.json'),
  [],
)

/** 数据根目录变更后丢弃内存缓存，下次访问按新目录重读 */
export function resetHistoryStore(): void {
  store.reset()
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
  store.update((items) => {
    items.unshift(item)
    if (items.length > MAX_HISTORY) items.length = MAX_HISTORY
  })
  return store.get()
}

export async function listHistory(): Promise<OfflinePackHistoryItem[]> {
  return store.get()
}

export async function deleteHistory(id: string, deleteFile: boolean): Promise<OfflinePackHistoryItem[]> {
  const target = store.get().find(item => item.id === id)
  if (target && deleteFile) {
    await removeIfExists(target.savedPath)
  }
  store.update((items) => {
    const index = items.findIndex(item => item.id === id)
    if (index >= 0) items.splice(index, 1)
  })
  return store.get()
}

export async function clearHistory(deleteFiles: boolean): Promise<void> {
  if (deleteFiles) {
    for (const item of store.get()) {
      await removeIfExists(item.savedPath)
    }
  }
  store.update((items) => {
    items.length = 0
  })
}
