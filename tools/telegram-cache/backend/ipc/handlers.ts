// telegram-cache 后端 IPC handler：全部为窄接口 —— 资源键 / 页面内核 ID / 枚举 / 数字。
// 渲染层永远不能传 URL、文件路径或 shell 命令；路径一律由主进程按数据根目录拼。
import type { TelegramResourceKind } from '../../../../shared/telegram-cache.ts'
import { ipcMain, shell } from 'electron'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { clearBenchmarks, getBenchmarkStatus, startBenchmark, stopBenchmark } from '../services/benchmark-service.ts'
import { clearTelegramCache } from '../services/cache-manager.ts'
import { exportTelegramDiagnostics, openTelegramDataDir } from '../services/diagnostics-service.ts'
import {
  acquireTelegramResource,
  cancelTelegramTask,
  refreshTelegramTaskConcurrency,
} from '../services/download-service.ts'
import { isTelegramResourceKey } from '../services/identity.ts'
import { listTelegramLibrary } from '../services/message-library.ts'
import { listTelegramMessageMedia, normalizeTelegramLibrary, telegramMessageDir } from '../services/message-store.ts'
import {
  beginMtprotoDownload,
  cancelMtprotoDownload,
  clearSecureSessionStorage,
  getMtprotoStatus,
  migrateSessionToSecureStorage,
} from '../services/mtproto-service.ts'
import {
  clearTelegramObservation,
  getTelegramTraffic,
  setTelegramObservationEnabled,
} from '../services/observation-service.ts'
import { attachTelegramPage, probeTelegramPage } from '../services/probe-service.ts'
import { runTelegramSelfTest } from '../services/self-test-service.ts'
import { getTelegramSiteServerInfo } from '../services/site-server.ts'
import { getTelegramSiteStatus } from '../services/site-service.ts'
import {
  broadcastTelegramSnapshotNow,
  buildTelegramSnapshot,
} from '../services/snapshot-service.ts'
import { emptyTelegramTrash, listTelegramTrash, moveTelegramMessageToTrash, restoreTelegramTrash } from '../services/trash-service.ts'
import { updateTelegramCacheConfig } from '../store/config-store.ts'
import { TELEGRAM_CACHE_IPC_CHANNELS } from './channels.ts'

let handlersRegistered = false

function requireWebContentsId(value: unknown): number {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new Error('页面内核 ID 非法')
  return id
}

function requireTaskId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('任务 ID 非法')
  return value.trim()
}

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

function parseAcquirePayload(value: unknown): { resourceKey: string, kind: TelegramResourceKind } {
  if (typeof value !== 'object' || value === null) throw new Error('资源请求参数非法')
  const payload = value as Record<string, unknown>
  if (!isTelegramResourceKey(payload.resourceKey)) throw new Error('资源键非法')
  // v4：只剩「存入资源库」一种意图；kind 参数保留以兼容旧调用，但恒为 cache
  return { resourceKey: payload.resourceKey, kind: 'cache' }
}

export function registerTelegramCacheHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.SNAPSHOT_GET, () => buildTelegramSnapshot())
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.TRAFFIC_GET, () => getTelegramTraffic())
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.SITE_INFO, () => getTelegramSiteStatus())

  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.CONFIG_SET, (_event, patch: unknown) => {
    const next = updateTelegramCacheConfig(patch)
    setTelegramObservationEnabled(next.observationEnabled)
    // 并发上限即时生效（排队任务按新上限调度）
    refreshTelegramTaskConcurrency()
    broadcastTelegramSnapshotNow()
    return { config: next, snapshot: buildTelegramSnapshot() }
  })

  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.OBSERVATION_SET_ENABLED, (_event, value: unknown) => {
    const enabled = value === true
    updateTelegramCacheConfig({ observationEnabled: enabled })
    setTelegramObservationEnabled(enabled)
    broadcastTelegramSnapshotNow()
    return buildTelegramSnapshot()
  })

  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.OBSERVATION_CLEAR, () => {
    clearTelegramObservation()
    broadcastTelegramSnapshotNow()
    return buildTelegramSnapshot()
  })

  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.PAGE_ATTACH, (_event, value: unknown) => {
    return attachTelegramPage(requireWebContentsId(value))
  })

  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.PAGE_PROBE, (_event, value: unknown) => {
    return probeTelegramPage(requireWebContentsId(value))
  })

  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.ACQUIRE, async (_event, value: unknown) => {
    const { resourceKey, kind } = parseAcquirePayload(value)
    const result = await acquireTelegramResource(resourceKey, kind)
    broadcastTelegramSnapshotNow()
    return {
      reused: result.reused,
      joined: result.joined,
      taskId: result.taskId,
      record: {
        resourceKey: result.record.resourceKey,
        displayUrl: result.record.displayUrl,
        size: result.record.actualSize ?? 0,
        sha256: result.record.sha256 ?? '',
        relativePath: result.record.relativePath ?? '',
        mimeType: result.record.mimeType ?? '',
        verification: result.record.verification,
      },
    }
  })

  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.TASK_CANCEL, (_event, value: unknown) => {
    return cancelTelegramTask(requireTaskId(value))
  })

  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.MSG_LIBRARY_LIST, () => listTelegramLibrary())
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.MSG_LIBRARY_MEDIA, async (_event, value: unknown) => {
    const { peerId, messageId } = parseLibraryTarget(value)
    const info = getTelegramSiteServerInfo()
    if (!info) throw new Error('本地站点未就绪')
    const items = await listTelegramMessageMedia(peerId, messageId)
    return {
      origin: info.url,
      items: items.map(item => ({
        ...item,
        url: `${info.url}media/${encodeURIComponent(item.mediaKey)}?t=${encodeURIComponent(info.token)}`,
      })),
    }
  })
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.MSG_LIBRARY_DELETE, async (_event, value: unknown) => {
    const { peerId, messageId } = parseLibraryTarget(value)
    const entry = await moveTelegramMessageToTrash(peerId, messageId)
    return { state: 'missing', entry }
  })
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.MSG_LIBRARY_OPEN_DIR, (_event, value: unknown) => {
    const { peerId, messageId } = parseLibraryTarget(value)
    const dir = telegramMessageDir(peerId, messageId)
    shell.showItemInFolder(dir)
    return true
  })
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.MSG_LIBRARY_NORMALIZE, () => normalizeTelegramLibrary())
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.TRASH_LIST, () => listTelegramTrash())
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.TRASH_RESTORE, (_event, value: unknown) => {
    if (typeof value !== 'string' || !/^[\w-]{1,120}$/.test(value)) throw new Error('回收站条目非法')
    return restoreTelegramTrash(value)
  })
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.TRASH_EMPTY, (_event, value: unknown) => {
    const days = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined
    return emptyTelegramTrash(days)
  })

  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.CACHE_CLEAR, async () => {
    const result = await clearTelegramCache()
    broadcastTelegramSnapshotNow()
    return { ...result, snapshot: buildTelegramSnapshot() }
  })

  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.SELF_TEST, () => runTelegramSelfTest())
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.MT_STATUS, () => getMtprotoStatus())
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.MT_DOWNLOAD, (_event, link: unknown) => beginMtprotoDownload(link))
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.MT_CANCEL, () => cancelMtprotoDownload())
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.MT_SESSION_MIGRATE, () => migrateSessionToSecureStorage())
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.MT_SESSION_CLEAR, () => clearSecureSessionStorage())
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.BENCHMARK_STATUS, () => getBenchmarkStatus())
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.BENCHMARK_START, (_event, label: unknown) => startBenchmark(label))
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.BENCHMARK_STOP, () => stopBenchmark())
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.BENCHMARK_CLEAR, () => clearBenchmarks())
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.DIAGNOSTICS_EXPORT, () => exportTelegramDiagnostics())
  safeHandle(ipcMain, TELEGRAM_CACHE_IPC_CHANNELS.OPEN_DATA_DIR, () => openTelegramDataDir())
}
