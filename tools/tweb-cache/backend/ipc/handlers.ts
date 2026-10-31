// tweb-cache 的 IPC handler：只做参数校验 + 转调平台层的归档引擎（作用域 = 本工具 id）。
// 存储逻辑一行都不在这里（见 backend/telegram-archive/engine.ts 与 telegram-cache 的实现）。
import { ipcMain, shell } from 'electron'
import { getTelegramArchiveEngine } from '../../../../backend/telegram-archive/engine.ts'
import { resolveLayerPath } from '../../../../backend/utils/data-layers.ts'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import {
  ensureTwebCacheSiteStarted,
  getTwebCacheMediaOrigin,
  getTwebCacheSiteStatus,
  releaseTwebCacheSite,
} from '../services/site-service.ts'
import { TWEB_CACHE_IPC_CHANNELS } from './channels.ts'

/** 存储作用域：归档数据落在 assets/tweb-cache/…（与 telegram-cache 各一份） */
const SCOPE = 'tweb-cache'

let handlersRegistered = false

function requirePeerId(value: unknown): string {
  if (typeof value !== 'string' || !/^-?\d{1,20}$/.test(value)) throw new Error('peer id 非法')
  return value
}

function requireMessageId(value: unknown): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('message id 非法')
  return id
}

function parseLibraryTarget(value: unknown): { peerId: string, messageId: number } {
  if (typeof value !== 'object' || value === null) throw new Error('影库参数非法')
  const payload = value as Record<string, unknown>
  return { peerId: requirePeerId(payload.peerId), messageId: requireMessageId(payload.messageId) }
}

export function registerTwebCacheHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  safeHandle(ipcMain, TWEB_CACHE_IPC_CHANNELS.SITE_INFO, () => getTwebCacheSiteStatus())
  safeHandle(ipcMain, TWEB_CACHE_IPC_CHANNELS.SITE_ACQUIRE, () => ensureTwebCacheSiteStarted())
  safeHandle(ipcMain, TWEB_CACHE_IPC_CHANNELS.SITE_RELEASE, () => {
    releaseTwebCacheSite()
    return true
  })

  safeHandle(ipcMain, TWEB_CACHE_IPC_CHANNELS.LIBRARY_LIST, async () => {
    const entries = await getTelegramArchiveEngine().listLibrary(SCOPE)
    const origin = getTwebCacheMediaOrigin()
    return entries.map(entry => ({
      ...entry,
      thumbnailUrl: origin && entry.thumbnailMediaKey
        ? `${origin.url}media/${encodeURIComponent(entry.thumbnailMediaKey)}?t=${encodeURIComponent(origin.token)}`
        : undefined,
    }))
  })
  safeHandle(ipcMain, TWEB_CACHE_IPC_CHANNELS.LIBRARY_DELETE, async (_event, value: unknown) => {
    const { peerId, messageId } = parseLibraryTarget(value)
    return getTelegramArchiveEngine().deleteMessage(SCOPE, peerId, messageId)
  })
  safeHandle(ipcMain, TWEB_CACHE_IPC_CHANNELS.LIBRARY_OPEN_DIR, async (_event, value: unknown) => {
    const { peerId, messageId } = parseLibraryTarget(value)
    await getTelegramArchiveEngine().revealMessageDir(SCOPE, peerId, messageId)
    return true
  })
  safeHandle(ipcMain, TWEB_CACHE_IPC_CHANNELS.LIBRARY_NORMALIZE, () => getTelegramArchiveEngine().normalizeLibrary(SCOPE))
  safeHandle(ipcMain, TWEB_CACHE_IPC_CHANNELS.TRASH_LIST, () => getTelegramArchiveEngine().listTrash(SCOPE))
  safeHandle(ipcMain, TWEB_CACHE_IPC_CHANNELS.TRASH_RESTORE, (_event, value: unknown) => {
    if (typeof value !== 'string' || !/^[\w-]{1,120}$/.test(value)) throw new Error('回收站条目非法')
    return getTelegramArchiveEngine().restoreTrash(SCOPE, value)
  })
  safeHandle(ipcMain, TWEB_CACHE_IPC_CHANNELS.TRASH_EMPTY, (_event, value: unknown) => {
    const days = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined
    return getTelegramArchiveEngine().emptyTrash(SCOPE, days)
  })
  safeHandle(ipcMain, TWEB_CACHE_IPC_CHANNELS.OPEN_DATA_DIR, async () => {
    const dir = resolveLayerPath('assets', SCOPE, 'messages')
    const error = await shell.openPath(dir)
    if (error) throw new Error(error)
    return true
  })
}
