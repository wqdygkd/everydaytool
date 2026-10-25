// 资源索引（data-root/telegram-cache/registry.json）：
// 只登记「已完整写入并计算过 SHA-256」的内容对象；下载中的临时文件永远不进索引。
// 索引是缓存命中的唯一依据：没有索引条目就重新下载，不靠文件名 / 大小猜。
import type { TelegramCompleteness, TelegramVerification } from '../../../../shared/telegram-cache.ts'
import type { CacheFreshness } from '../services/http-semantics.ts'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { getTelegramCacheRoot, getTelegramRegistryPath } from '../utils/paths.ts'

export interface TelegramResourceRecord {
  resourceKey: string
  sourceType: 'http' | 'telegram-mtproto' | 'page-captured'
  displayUrl: string
  host: string
  mimeType?: string
  expectedSize?: number
  actualSize?: number
  sha256?: string
  /** 相对数据根目录 telegram-cache/ 的路径 */
  relativePath?: string
  completeness: TelegramCompleteness
  verification: TelegramVerification
  cacheRefs: number
  archiveRefs: number
  lastAccessedAt?: number
  createdAt: number
  updatedAt: number
  /** M2：HTTP 缓存语义（缓存控制 / 新鲜度 / 是否允许本地响应）；旧索引可能没有 */
  cache?: CacheFreshness
  /** 来源元数据（MTProto：媒体指纹，用于判断同一消息媒体是否已下载） */
  sourceMeta?: { mtprotoFingerprint?: string }
}

interface RegistryDocument {
  schemaVersion: 1
  resources: Record<string, TelegramResourceRecord>
}

/** 索引条目上限：超出后丢弃「最久未访问且未被归档引用」的条目（对象文件不在此处删除） */
const MAX_REGISTRY_RECORDS = 500

function emptyDocument(): RegistryDocument {
  return { schemaVersion: 1, resources: {} }
}

function isRecord(value: unknown): value is TelegramResourceRecord {
  if (typeof value !== 'object' || value === null) return false
  const rec = value as Record<string, unknown>
  return typeof rec.resourceKey === 'string'
    && typeof rec.createdAt === 'number'
    && typeof rec.updatedAt === 'number'
}

function sanitizeCache(value: unknown): CacheFreshness | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const rec = value as Record<string, unknown>
  const storedAt = typeof rec.storedAt === 'number' && Number.isFinite(rec.storedAt) ? rec.storedAt : 0
  const freshUntil = typeof rec.freshUntil === 'number' && Number.isFinite(rec.freshUntil) ? rec.freshUntil : null
  const maxAgeSeconds = typeof rec.maxAgeSeconds === 'number' && Number.isFinite(rec.maxAgeSeconds)
    ? Math.max(0, Math.floor(rec.maxAgeSeconds))
    : null
  return {
    cacheControl: typeof rec.cacheControl === 'string' ? rec.cacheControl.slice(0, 512) : undefined,
    etag: typeof rec.etag === 'string' ? rec.etag.slice(0, 256) : undefined,
    lastModified: typeof rec.lastModified === 'string' ? rec.lastModified.slice(0, 128) : undefined,
    vary: typeof rec.vary === 'string' ? rec.vary.slice(0, 128) : undefined,
    corsAllowOrigin: typeof rec.corsAllowOrigin === 'string' ? rec.corsAllowOrigin.slice(0, 256) : undefined,
    noStore: rec.noStore === true,
    noCache: rec.noCache === true,
    private: rec.private === true,
    maxAgeSeconds,
    quotaManaged: rec.quotaManaged !== false,
    cacheable: rec.cacheable === true,
    serveClass: rec.serveClass === 'image' || rec.serveClass === 'media' ? rec.serveClass : 'none',
    freshUntil,
    storedAt,
  }
}

function readDocument(): RegistryDocument {
  const doc = readJsonDocument<RegistryDocument>(getTelegramRegistryPath(), emptyDocument)
  const resources: Record<string, TelegramResourceRecord> = {}
  if (doc && typeof doc.resources === 'object' && doc.resources !== null) {
    for (const [key, value] of Object.entries(doc.resources)) {
      if (!isRecord(value)) continue
      resources[key] = {
        ...value,
        cache: sanitizeCache(value.cache),
        sourceMeta: typeof value.sourceMeta === 'object' && value.sourceMeta !== null
          ? { mtprotoFingerprint: typeof (value.sourceMeta as { mtprotoFingerprint?: unknown }).mtprotoFingerprint === 'string'
              ? (value.sourceMeta as { mtprotoFingerprint: string }).mtprotoFingerprint.slice(0, 200)
              : undefined }
          : undefined,
        sourceType: value.sourceType === 'telegram-mtproto' || value.sourceType === 'page-captured'
          ? value.sourceType
          : 'http',
        completeness: value.completeness === 'complete' || value.completeness === 'partial' ? value.completeness : 'unknown',
        verification: value.verification === 'verified' ? 'verified' : 'unverified',
        cacheRefs: Number.isFinite(value.cacheRefs) ? Math.max(0, Math.floor(value.cacheRefs)) : 0,
        archiveRefs: Number.isFinite(value.archiveRefs) ? Math.max(0, Math.floor(value.archiveRefs)) : 0,
      }
    }
  }
  return { schemaVersion: 1, resources }
}

function writeDocument(doc: RegistryDocument): void {
  const entries = Object.entries(doc.resources)
  if (entries.length > MAX_REGISTRY_RECORDS) {
    // 归档引用的条目必须保留（方案文档 hard requirement：缓存淘汰不得影响归档）
    const removable = entries
      .filter(([, rec]) => rec.archiveRefs === 0)
      .sort((a, b) => (a[1].lastAccessedAt ?? a[1].updatedAt) - (b[1].lastAccessedAt ?? b[1].updatedAt))
    const excess = entries.length - MAX_REGISTRY_RECORDS
    for (const [key] of removable.slice(0, excess)) {
      const record = doc.resources[key]
      delete doc.resources[key]
      // 被丢弃的条目如果独占一个内容对象，顺手删文件，避免索引外出现不可见的孤儿对象
      if (!record?.relativePath) continue
      const stillReferenced = Object.values(doc.resources).some(item => item.relativePath === record.relativePath)
      if (stillReferenced) continue
      const target = resolveTelegramObjectPath(record)
      if (!target) continue
      try {
        rmSync(target, { force: true })
      } catch {
        // 文件正被读取 / 已不存在：忽略，下次清理再处理
      }
    }
  }
  writeJsonDocument(getTelegramRegistryPath(), doc)
}

export function listTelegramResourceRecords(): TelegramResourceRecord[] {
  return Object.values(readDocument().resources)
}

export function getTelegramResourceRecord(resourceKey: string): TelegramResourceRecord | undefined {
  return readDocument().resources[resourceKey]
}

export function isVerifiedCompleteRecord(record: TelegramResourceRecord | undefined): boolean {
  if (!record) return false
  return record.completeness === 'complete'
    && record.verification === 'verified'
    && Boolean(record.relativePath)
}

/**
 * 解析记录对应的对象绝对路径。
 * 记录来自本地 JSON，但仍按「相对路径 + 根目录前缀」校验，拒绝穿越到数据目录之外。
 */
export function resolveTelegramObjectPath(record: TelegramResourceRecord): string | null {
  if (!record.relativePath) return null
  const root = path.resolve(getTelegramCacheRoot())
  const target = path.resolve(root, record.relativePath)
  if (target !== root && !target.startsWith(root + path.sep)) return null
  return target
}

export function recordTelegramContent(input: {
  resourceKey: string
  sourceType?: 'http' | 'telegram-mtproto' | 'page-captured'
  displayUrl: string
  host: string
  mimeType?: string
  expectedSize?: number
  actualSize: number
  sha256: string
  relativePath: string
  cache?: CacheFreshness
  sourceMeta?: { mtprotoFingerprint?: string }
}): TelegramResourceRecord {
  const doc = readDocument()
  const now = Date.now()
  const existing = doc.resources[input.resourceKey]
  const record: TelegramResourceRecord = {
    resourceKey: input.resourceKey,
    sourceType: input.sourceType ?? 'http',
    displayUrl: input.displayUrl,
    host: input.host,
    mimeType: input.mimeType,
    expectedSize: input.expectedSize,
    actualSize: input.actualSize,
    sha256: input.sha256,
    relativePath: input.relativePath,
    completeness: 'complete',
    verification: 'verified',
    cacheRefs: (existing?.cacheRefs ?? 0) + 1,
    archiveRefs: existing?.archiveRefs ?? 0,
    lastAccessedAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    cache: input.cache,
    sourceMeta: input.sourceMeta,
  }
  doc.resources[input.resourceKey] = record
  writeDocument(doc)
  return record
}

/** 删除单条索引（缓存淘汰 / 显式清理用）；对象文件由调用方按引用情况决定是否删除 */
export function removeTelegramResourceRecord(resourceKey: string): TelegramResourceRecord | undefined {
  const doc = readDocument()
  const record = doc.resources[resourceKey]
  if (!record) return undefined
  delete doc.resources[resourceKey]
  writeDocument(doc)
  return record
}

/** 是否有其它条目仍引用同一个内容对象（内容寻址下多条记录可共享一份文件） */
export function isTelegramObjectReferenced(relativePath: string, exceptKey?: string): boolean {
  return Object.values(readDocument().resources)
    .some(record => record.resourceKey !== exceptKey && record.relativePath === relativePath)
}

/** 304 条件验证成功后刷新缓存元数据（内容对象与哈希不变） */
export function updateTelegramResourceCache(resourceKey: string, cache: CacheFreshness): TelegramResourceRecord | undefined {
  const doc = readDocument()
  const record = doc.resources[resourceKey]
  if (!record) return undefined
  record.cache = cache
  record.lastAccessedAt = Date.now()
  record.updatedAt = record.lastAccessedAt
  writeDocument(doc)
  return record
}

/** 命中已有资源库：只更新访问时间与引用计数，不重复写文件 */
export function touchTelegramResource(resourceKey: string, kind: 'cache' | 'archive'): TelegramResourceRecord | undefined {
  const doc = readDocument()
  const record = doc.resources[resourceKey]
  if (!record) return undefined
  const now = Date.now()
  record.lastAccessedAt = now
  if (kind === 'cache') record.cacheRefs += 1
  writeDocument(doc)
  return record
}

export function incrementTelegramArchiveRef(resourceKey: string): TelegramResourceRecord | undefined {
  const doc = readDocument()
  const record = doc.resources[resourceKey]
  if (!record) return undefined
  const now = Date.now()
  record.archiveRefs += 1
  record.lastAccessedAt = now
  record.updatedAt = now
  writeDocument(doc)
  return record
}

/**
 * 启动恢复：索引指向的文件已不存在时删除条目（等价 cache miss），
 * 避免把「只剩一条记录」当成可复用内容。归档副本不在索引里，因此不受影响。
 */
export function pruneTelegramRegistry(): void {
  const doc = readDocument()
  let changed = false
  for (const [key, record] of Object.entries(doc.resources)) {
    const target = resolveTelegramObjectPath(record)
    if (target && existsSync(target)) continue
    delete doc.resources[key]
    changed = true
  }
  if (changed) writeDocument(doc)
}

export function clearTelegramRegistry(): void {
  writeJsonDocument(getTelegramRegistryPath(), emptyDocument())
}
