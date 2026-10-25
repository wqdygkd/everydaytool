// M2 缓存管理器：配额记账 + LRU 淘汰 + 显式清理 + 运行时计量。
//
// 硬约束（方案文档 §9.3 / §13）：
// - 淘汰绝不删「唯一副本」：若条目被归档且归档副本真实存在，删缓存对象是安全的（归档是独立副本）；
//   若归档索引只有指针、文件已不存在，则跳过该条目。
// - 正在下载 / 正在被任务使用的资源键跳过（由 download-service 注入 provider）。
// - no-store 内容只为用户主动归档保留：不占缓存配额、不参与 LRU。
// - 内容寻址下多条记录可共享同一对象文件：只有最后一条引用消失时才删除文件。
import type { TelegramResourceRecord } from '../store/resource-registry.ts'
import { rm } from 'node:fs/promises'
import { logger } from '../../../../backend/utils/logger.ts'
import { getTelegramCacheConfig } from '../store/config-store.ts'
import {
  isTelegramObjectReferenced,
  isVerifiedCompleteRecord,
  listTelegramResourceRecords,
  removeTelegramResourceRecord,
  resolveTelegramObjectPath,
} from '../store/resource-registry.ts'
import { hasTelegramArchiveCopy } from './archive-service.ts'

export interface TelegramCacheUsage {
  sizeBytes: number
  entryCount: number
  uniqueObjects: number
}

export interface CacheMeters {
  servedBytes: number
  localHits: number
  localMisses: number
  revalidations: number
  revalidationHits: number
  evictedBytes: number
  evictions: number
  lastEvictionAt: number | null
}

const meters: CacheMeters = {
  servedBytes: 0,
  localHits: 0,
  localMisses: 0,
  revalidations: 0,
  revalidationHits: 0,
  evictedBytes: 0,
  evictions: 0,
  lastEvictionAt: null,
}

let activeKeysProvider: (() => Set<string>) | null = null
let enforcing = false

/** download-service 注入：返回当前 queued / running 任务的资源键，淘汰时跳过 */
export function setTelegramActiveCacheKeysProvider(provider: (() => Set<string>) | null): void {
  activeKeysProvider = provider
}

export function noteTelegramLocalHit(bytes: number): void {
  meters.localHits += 1
  if (Number.isFinite(bytes) && bytes > 0) meters.servedBytes += bytes
}

export function noteTelegramLocalMiss(): void {
  meters.localMisses += 1
}

export function noteTelegramRevalidation(hit: boolean): void {
  meters.revalidations += 1
  if (hit) meters.revalidationHits += 1
}

export function getTelegramCacheMeters(): CacheMeters {
  return { ...meters }
}

/** 计入配额的对象按「唯一相对路径」记账，避免同内容多键重复计算 */
export function getTelegramCacheUsage(): TelegramCacheUsage {
  const records = listTelegramResourceRecords().filter(record => isVerifiedCompleteRecord(record))
  const byPath = new Map<string, { size: number, quotaManaged: boolean }>()
  for (const record of records) {
    if (!record.relativePath) continue
    const existing = byPath.get(record.relativePath)
    const quotaManaged = record.cache?.quotaManaged !== false
    if (!existing) {
      byPath.set(record.relativePath, { size: record.actualSize ?? 0, quotaManaged })
    } else {
      existing.size = Math.max(existing.size, record.actualSize ?? 0)
      existing.quotaManaged = existing.quotaManaged || quotaManaged
    }
  }
  let sizeBytes = 0
  for (const entry of byPath.values()) {
    if (entry.quotaManaged) sizeBytes += entry.size
  }
  return { sizeBytes, entryCount: records.length, uniqueObjects: byPath.size }
}

function canEvict(record: TelegramResourceRecord, activeKeys: Set<string>): string | null {
  if (activeKeys.has(record.resourceKey)) return '任务进行中'
  if (record.cache?.quotaManaged === false) return 'no-store（用户主动保存，不占配额）'
  if (record.archiveRefs > 0 && !hasTelegramArchiveCopy(record)) return '唯一副本被归档引用'
  return null
}

/**
 * 删除不再被任何条目引用的对象文件；返回真正释放的字节数（共享对象只在最后一个引用消失时计一次）。
 */
async function deleteObjectIfUnreferenced(record: TelegramResourceRecord): Promise<number> {
  const relativePath = record.relativePath
  if (!relativePath) return 0
  if (isTelegramObjectReferenced(relativePath, record.resourceKey)) return 0
  const absolute = resolveTelegramObjectPath(record)
  if (!absolute) return 0
  try {
    await rm(absolute, { force: true })
    return record.actualSize ?? 0
  } catch (error) {
    // Windows 上文件可能正被读取：留下孤立对象，下次清理可再删，不影响索引一致性
    logger.warn('Failed to remove cached object', { error: (error as Error).message })
    return 0
  }
}

function sortLeastRecentlyUsed(records: TelegramResourceRecord[]): TelegramResourceRecord[] {
  return [...records].sort(
    (a, b) => (a.lastAccessedAt ?? a.updatedAt) - (b.lastAccessedAt ?? b.updatedAt),
  )
}

export interface CacheSweepResult {
  evictedBytes: number
  evictions: number
}

/**
 * 按配置配额淘汰：超过上限时从最久未访问的条目开始删，直到回到上限以内。
 * 并发调用只会真正执行一次（避免两次清理互相踩）。
 */
export async function enforceTelegramCacheQuota(): Promise<CacheSweepResult> {
  if (enforcing) return { evictedBytes: 0, evictions: 0 }
  enforcing = true
  try {
    const config = getTelegramCacheConfig()
    const activeKeys = activeKeysProvider?.() ?? new Set<string>()
    let usage = getTelegramCacheUsage()
    if (usage.sizeBytes <= config.cacheMaxBytes) return { evictedBytes: 0, evictions: 0 }

    let evictedBytes = 0
    let evictions = 0
    for (const record of sortLeastRecentlyUsed(listTelegramResourceRecords())) {
      if (usage.sizeBytes <= config.cacheMaxBytes) break
      if (canEvict(record, activeKeys)) continue
      removeTelegramResourceRecord(record.resourceKey)
      evictedBytes += await deleteObjectIfUnreferenced(record)
      usage = getTelegramCacheUsage()
      evictions += 1
    }

    if (evictions > 0) {
      meters.evictedBytes += evictedBytes
      meters.evictions += evictions
      meters.lastEvictionAt = Date.now()
      logger.info('Telegram cache eviction', { evictions, evictedBytes, remainingBytes: usage.sizeBytes })
    }
    return { evictedBytes, evictions }
  } finally {
    enforcing = false
  }
}

/**
 * 显式清理缓存（用户点「清理缓存」）：
 * - 跳过任务进行中的条目；
 * - 跳过「没有归档副本的唯一内容」；
 * - 跳过 no-store（那是用户主动保存的内容，不属于缓存配额）。
 */
export async function clearTelegramCache(): Promise<CacheSweepResult> {
  const activeKeys = activeKeysProvider?.() ?? new Set<string>()
  let evictedBytes = 0
  let evictions = 0
  for (const record of sortLeastRecentlyUsed(listTelegramResourceRecords())) {
    if (canEvict(record, activeKeys)) continue
    removeTelegramResourceRecord(record.resourceKey)
    evictedBytes += await deleteObjectIfUnreferenced(record)
    evictions += 1
  }
  if (evictions > 0) {
    meters.evictedBytes += evictedBytes
    meters.evictions += evictions
    meters.lastEvictionAt = Date.now()
  }
  return { evictedBytes, evictions }
}
