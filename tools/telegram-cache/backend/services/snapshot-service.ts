// 快照服务：把观测 / 资源索引 / 任务 / 配置聚合成一个渲染层可直接渲染的对象。
// 推送按 700ms 节流（观测期间每个请求都可能触发变化，逐条推送会淹没 IPC）；
// 用户主动操作（清空 / 改配置 / 归档完成）走立即推送。
import type {
  TelegramResourceSummary,
  TelegramResourceType,
  TelegramSnapshot,
  TelegramStoredInfo,
} from '../../../../shared/telegram-cache.ts'
import type { TelegramResourceRecord } from '../store/resource-registry.ts'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { getDataDirectory } from '../../../../backend/utils/data-root.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { getPartitionStoragePath, isSessionDataInDataDirectory } from '../../../../backend/utils/session-data.ts'
import { TELEGRAM_RESOURCE_LIMIT } from '../../../../shared/telegram-cache.ts'
import { TELEGRAM_CACHE_IPC_CHANNELS } from '../ipc/channels.ts'
import { getTelegramCacheConfig } from '../store/config-store.ts'
import { isVerifiedCompleteRecord, listTelegramResourceRecords } from '../store/resource-registry.ts'
import { getTelegramCacheMeters, getTelegramCacheUsage } from './cache-manager.ts'
import { listTelegramTaskSnapshots } from './download-service.ts'
import {
  getTelegramCapabilities,
  getTelegramObservationStats,
  listObservedResources,
  setTelegramObservationChangeHandler,
} from './observation-service.ts'
import { getTelegramSiteStatus } from './site-service.ts'

const SNAPSHOT_THROTTLE_MS = 700

let snapshotTimer: ReturnType<typeof setTimeout> | null = null

function resourceTypeFromMime(mimeType?: string): TelegramResourceType {
  if (!mimeType) return 'other'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) return 'media'
  if (mimeType.startsWith('font/')) return 'font'
  return 'other'
}

function toStoredInfo(record: TelegramResourceRecord): TelegramStoredInfo {
  return {
    size: record.actualSize ?? 0,
    sha256: record.sha256 ?? '',
    completeness: record.completeness,
    verification: record.verification,
    relativePath: record.relativePath ?? '',
    updatedAt: record.updatedAt,
    cacheable: record.cache?.cacheable === true,
    serveClass: record.cache?.serveClass ?? 'none',
    quotaManaged: record.cache?.quotaManaged !== false,
    freshUntil: record.cache?.freshUntil ?? null,
    cacheControl: record.cache?.cacheControl,
    etag: record.cache?.etag,
  }
}

export function buildTelegramResourceSummaries(): TelegramResourceSummary[] {
  const records = new Map(listTelegramResourceRecords().map(record => [record.resourceKey, record]))
  const summaries = new Map<string, TelegramResourceSummary>()

  for (const observed of listObservedResources()) {
    const key = observed.identity.resourceKey
    const record = records.get(key)
    summaries.set(key, {
      resourceKey: key,
      displayUrl: observed.identity.displayUrl,
      host: observed.identity.host,
      path: observed.identity.path,
      resourceType: observed.resourceType,
      mimeType: observed.mimeType ?? record?.mimeType,
      size: observed.sizeKnown ? observed.size : record?.actualSize ?? 0,
      sizeKnown: observed.sizeKnown || Boolean(record?.actualSize),
      requests: observed.requests,
      fromCache: observed.fromCache,
      statusCode: observed.statusCode,
      lastSeenAt: observed.lastSeenAt,
      downloadable: observed.identity.downloadable,
      stored: record && isVerifiedCompleteRecord(record) ? toStoredInfo(record) : undefined,
    })
  }

  // 资源库里存在、但本次会话没再观测到的条目：保留展示（可继续归档），不可重新下载
  for (const record of records.values()) {
    if (summaries.has(record.resourceKey) || !isVerifiedCompleteRecord(record)) continue
    summaries.set(record.resourceKey, {
      resourceKey: record.resourceKey,
      displayUrl: record.displayUrl,
      host: record.host,
      path: record.displayUrl,
      resourceType: resourceTypeFromMime(record.mimeType),
      mimeType: record.mimeType,
      size: record.actualSize ?? 0,
      sizeKnown: Boolean(record.actualSize),
      requests: 0,
      fromCache: false,
      lastSeenAt: record.lastAccessedAt ?? record.updatedAt,
      downloadable: false,
      stored: toStoredInfo(record),
    })
  }

  return [...summaries.values()]
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, TELEGRAM_RESOURCE_LIMIT)
}

export function buildTelegramSnapshot(): TelegramSnapshot {
  const config = getTelegramCacheConfig()
  const usage = getTelegramCacheUsage()
  const meters = getTelegramCacheMeters()
  return {
    stats: getTelegramObservationStats(),
    cache: {
      sizeBytes: usage.sizeBytes,
      entryCount: usage.entryCount,
      maxBytes: config.cacheMaxBytes,
      servedBytes: 0,
      localHits: 0,
      localMisses: 0,
      revalidations: 0,
      revalidationHits: 0,
      evictedBytes: meters.evictedBytes,
      evictions: meters.evictions,
      lastEvictionAt: meters.lastEvictionAt,
      localResponseEnabled: false,
      localMediaRangeEnabled: false,
      handlerInstalled: false,
      pageCaptureEnabled: false,
      pageCaptureAttached: false,
      pageCapturedBytes: 0,
      pageCaptureHits: 0,
      pageCaptureMisses: 0,
    },
    resources: buildTelegramResourceSummaries(),
    tasks: listTelegramTaskSnapshots(),
    capabilities: getTelegramCapabilities(),
    config,
    dataDirectory: getDataDirectory(),
    webSession: {
      directory: getPartitionStoragePath('telegram-cache'),
      inDataDirectory: isSessionDataInDataDirectory(),
      restartRequired: !isSessionDataInDataDirectory(),
    },
    site: getTelegramSiteStatus(),
    generatedAt: Date.now(),
  }
}

function pushSnapshot(): void {
  broadcastToWindows(TELEGRAM_CACHE_IPC_CHANNELS.EVENT_SNAPSHOT, buildTelegramSnapshot(), {
    onError: error => logger.warn('Telegram snapshot broadcast failed', { error: error.message }),
  })
}

export function scheduleTelegramSnapshotBroadcast(): void {
  if (snapshotTimer) return
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null
    pushSnapshot()
  }, SNAPSHOT_THROTTLE_MS)
}

export function broadcastTelegramSnapshotNow(): void {
  if (snapshotTimer) {
    clearTimeout(snapshotTimer)
    snapshotTimer = null
  }
  pushSnapshot()
}

/** 后端 initialize 时调用：把观测变化接到节流推送，并推一次初始快照 */
export function startTelegramSnapshotPublisher(): void {
  setTelegramObservationChangeHandler(scheduleTelegramSnapshotBroadcast)
  scheduleTelegramSnapshotBroadcast()
}

export function stopTelegramSnapshotPublisher(): void {
  setTelegramObservationChangeHandler(null)
  if (snapshotTimer) {
    clearTimeout(snapshotTimer)
    snapshotTimer = null
  }
}
