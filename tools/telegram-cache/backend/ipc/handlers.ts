// telegram-cache 后端 IPC handler：全部为窄接口 —— 资源键 / 页面内核 ID / 枚举 / 数字。
// 渲染层永远不能传 URL、文件路径或 shell 命令；路径一律由主进程按数据根目录拼。
import type { TelegramResourceKind } from '../../../../shared/telegram-cache.ts'
import { createRequire } from 'node:module'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { listTelegramArchives, openTelegramArchiveDir } from '../services/archive-service.ts'
import { clearBenchmarks, getBenchmarkStatus, startBenchmark, stopBenchmark } from '../services/benchmark-service.ts'
import { clearTelegramCache } from '../services/cache-manager.ts'
import { exportTelegramDiagnostics, openTelegramDataDir } from '../services/diagnostics-service.ts'
import {
  acquireTelegramResource,
  cancelTelegramTask,
  refreshTelegramTaskConcurrency,
} from '../services/download-service.ts'
import { buildTelegramFeasibilityReport } from '../services/feasibility-service.ts'
import { isTelegramResourceKey } from '../services/identity.ts'
import { syncTelegramLocalResponseWithConfig } from '../services/local-response-service.ts'
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
import { syncPageCaptureWithConfig } from '../services/page-capture-service.ts'
import { attachTelegramPage, probeTelegramPage } from '../services/probe-service.ts'
import { runTelegramSelfTest } from '../services/self-test-service.ts'
import {
  broadcastTelegramSnapshotNow,
  buildTelegramSnapshot,
} from '../services/snapshot-service.ts'
import { updateTelegramCacheConfig } from '../store/config-store.ts'
import { TELEGRAM_IPC_CHANNELS } from './channels.ts'

const require = createRequire(import.meta.url)
const { ipcMain } = require('electron') as typeof import('electron')

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

function parseAcquirePayload(value: unknown): { resourceKey: string, kind: TelegramResourceKind } {
  if (typeof value !== 'object' || value === null) throw new Error('资源请求参数非法')
  const payload = value as Record<string, unknown>
  if (!isTelegramResourceKey(payload.resourceKey)) throw new Error('资源键非法')
  const kind = payload.kind === 'archive' ? 'archive' : payload.kind === 'cache' ? 'cache' : null
  if (!kind) throw new Error('资源操作类型非法')
  return { resourceKey: payload.resourceKey, kind }
}

export function registerTelegramCacheHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.SNAPSHOT_GET, () => buildTelegramSnapshot())
  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.TRAFFIC_GET, () => getTelegramTraffic())

  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.CONFIG_SET, (_event, patch: unknown) => {
    const next = updateTelegramCacheConfig(patch)
    setTelegramObservationEnabled(next.observationEnabled)
    // 并发上限即时生效（排队任务按新上限调度）
    refreshTelegramTaskConcurrency()
    // 本地响应开关即时安装 / 卸载协议处理器
    syncTelegramLocalResponseWithConfig()
    // 页面捕获开关即时 attach / detach CDP
    syncPageCaptureWithConfig()
    broadcastTelegramSnapshotNow()
    return { config: next, snapshot: buildTelegramSnapshot() }
  })

  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.OBSERVATION_SET_ENABLED, (_event, value: unknown) => {
    const enabled = value === true
    updateTelegramCacheConfig({ observationEnabled: enabled })
    setTelegramObservationEnabled(enabled)
    broadcastTelegramSnapshotNow()
    return buildTelegramSnapshot()
  })

  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.OBSERVATION_CLEAR, () => {
    clearTelegramObservation()
    broadcastTelegramSnapshotNow()
    return buildTelegramSnapshot()
  })

  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.PAGE_ATTACH, (_event, value: unknown) => {
    const result = attachTelegramPage(requireWebContentsId(value))
    // 页面 attach 后才具备捕获目标；开关已开启时立即绑定 CDP
    syncPageCaptureWithConfig()
    return result
  })

  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.PAGE_PROBE, (_event, value: unknown) => {
    return probeTelegramPage(requireWebContentsId(value))
  })

  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.ACQUIRE, async (_event, value: unknown) => {
    const { resourceKey, kind } = parseAcquirePayload(value)
    const result = await acquireTelegramResource(resourceKey, kind)
    broadcastTelegramSnapshotNow()
    return {
      reused: result.reused,
      joined: result.joined,
      archiveRelativePath: result.archiveRelativePath,
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

  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.TASK_CANCEL, (_event, value: unknown) => {
    return cancelTelegramTask(requireTaskId(value))
  })

  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.ARCHIVE_LIST, () => listTelegramArchives())
  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.ARCHIVE_OPEN_DIR, () => openTelegramArchiveDir())

  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.CACHE_CLEAR, async () => {
    const result = await clearTelegramCache()
    broadcastTelegramSnapshotNow()
    return { ...result, snapshot: buildTelegramSnapshot() }
  })

  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.SELF_TEST, () => runTelegramSelfTest())
  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.M3_REPORT, () => buildTelegramFeasibilityReport())
  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.MT_STATUS, () => getMtprotoStatus())
  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.MT_DOWNLOAD, (_event, link: unknown) => beginMtprotoDownload(link))
  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.MT_CANCEL, () => cancelMtprotoDownload())
  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.MT_SESSION_MIGRATE, () => migrateSessionToSecureStorage())
  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.MT_SESSION_CLEAR, () => clearSecureSessionStorage())
  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.BENCHMARK_STATUS, () => getBenchmarkStatus())
  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.BENCHMARK_START, (_event, label: unknown) => startBenchmark(label))
  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.BENCHMARK_STOP, () => stopBenchmark())
  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.BENCHMARK_CLEAR, () => clearBenchmarks())
  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.DIAGNOSTICS_EXPORT, () => exportTelegramDiagnostics())
  safeHandle(ipcMain, TELEGRAM_IPC_CHANNELS.OPEN_DATA_DIR, () => openTelegramDataDir())
}
