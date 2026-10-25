// M1 归档：把资源库里已校验的对象复制为**独立副本**（方案文档 §9.3 / §13.1 的硬要求：
// 缓存淘汰不得让归档失去唯一内容）。归档按内容哈希取目录，不复制用户原始文件名。
import type { TelegramArchiveEntry } from '../../../../shared/telegram-cache.ts'
import type { TelegramResourceRecord } from '../store/resource-registry.ts'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { incrementTelegramArchiveRef, resolveTelegramObjectPath } from '../store/resource-registry.ts'
import { getTelegramArchiveIndexPath, getTelegramArchiveRoot, getTelegramCacheRoot, toTelegramRelativePath } from '../utils/paths.ts'

const require = createRequire(import.meta.url)
const { shell } = require('electron') as typeof import('electron')

interface ArchiveDocument {
  schemaVersion: 1
  entries: Record<string, TelegramArchiveEntry>
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/json': '.json',
}

function readDocument(): ArchiveDocument {
  const doc = readJsonDocument<ArchiveDocument>(getTelegramArchiveIndexPath(), () => ({ schemaVersion: 1, entries: {} }))
  if (!doc || typeof doc.entries !== 'object' || doc.entries === null) {
    return { schemaVersion: 1, entries: {} }
  }
  return { schemaVersion: 1, entries: doc.entries }
}

function writeDocument(doc: ArchiveDocument): void {
  writeJsonDocument(getTelegramArchiveIndexPath(), doc)
}

export function listTelegramArchives(): TelegramArchiveEntry[] {
  return Object.values(readDocument().entries).sort((a, b) => b.savedAt - a.savedAt)
}

export function getTelegramArchiveCount(): number {
  return Object.keys(readDocument().entries).length
}

/**
 * 该资源是否已有一份**真实存在**的归档副本。
 * 缓存淘汰用它判断「删掉缓存对象会不会丢掉唯一内容」；归档索引里只有指针不算数。
 */
export function hasTelegramArchiveCopy(record: TelegramResourceRecord): boolean {
  if (!record.sha256) return false
  const archiveId = `res-${record.sha256.slice(0, 16)}`
  const entry = readDocument().entries[archiveId]
  if (!entry) return false
  return existsSync(path.resolve(getTelegramCacheRoot(), entry.relativePath))
}

/** 归档文件名由应用生成：内容哈希 + MIME 推断的扩展名，绝不使用原始文件名 / 用户文本 */
function archiveIdOf(record: TelegramResourceRecord): string {
  const digest = record.sha256 ?? 'unknown'
  return `res-${digest.slice(0, 16)}`
}

function archiveFileNameOf(record: TelegramResourceRecord): string {
  return `resource${EXTENSION_BY_MIME[record.mimeType ?? ''] ?? '.bin'}`
}

function archiveDirOf(archiveId: string): string {
  return path.join(getTelegramArchiveRoot(), 'resources', archiveId)
}

/**
 * 归档一份已校验资源。幂等：同一内容（同 SHA-256）已有归档时只增加引用计数。
 * 复制流程同样是「临时文件 → 校验大小 → rename」，中断不会留下看似完整的归档文件。
 */
export async function archiveTelegramResource(record: TelegramResourceRecord): Promise<TelegramArchiveEntry> {
  const sourcePath = resolveTelegramObjectPath(record)
  if (!sourcePath || !existsSync(sourcePath)) {
    throw new Error('资源库中的内容文件不存在，无法归档（请重新下载该资源）')
  }
  if (!record.sha256 || !record.actualSize) {
    throw new Error('资源记录缺少哈希或大小，不能归档（索引可能已损坏，请重新下载该资源）')
  }

  const archiveId = archiveIdOf(record)
  const doc = readDocument()
  const existing = doc.entries[archiveId]
  if (existing && existsSync(path.resolve(getTelegramCacheRoot(), existing.relativePath))) {
    incrementTelegramArchiveRef(record.resourceKey)
    return existing
  }

  const dir = archiveDirOf(archiveId)
  await mkdir(dir, { recursive: true })
  const fileName = archiveFileNameOf(record)
  const finalPath = path.join(dir, fileName)
  const tmpPath = path.join(dir, `${fileName}.${randomUUID().slice(0, 6)}.part`)

  const expectedSize = record.actualSize ?? 0
  try {
    await copyFile(sourcePath, tmpPath)
    const info = await stat(tmpPath)
    if (info.size === 0 || (expectedSize > 0 && info.size !== expectedSize)) {
      throw new Error(`归档副本大小校验失败：期望 ${expectedSize} 字节，实际 ${info.size} 字节`)
    }
    if (existsSync(finalPath)) await rm(finalPath, { force: true })
    await rename(tmpPath, finalPath)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }

  const savedAt = Date.now()
  const entry: TelegramArchiveEntry = {
    archiveId,
    resourceKey: record.resourceKey,
    displayUrl: record.displayUrl,
    host: record.host,
    relativePath: toTelegramRelativePath(finalPath),
    size: expectedSize,
    sha256: record.sha256 ?? '',
    mimeType: record.mimeType,
    savedAt,
  }

  // 每条归档带自己的清单，索引只是索引：索引损坏 / 重建不影响已落盘内容
  await writeFile(path.join(dir, 'meta.json'), `${JSON.stringify({
    schemaVersion: 1,
    archiveId,
    resourceKey: record.resourceKey,
    displayUrl: record.displayUrl,
    host: record.host,
    mimeType: record.mimeType ?? null,
    size: expectedSize,
    sha256: record.sha256 ?? null,
    savedAt: new Date(savedAt).toISOString(),
    sourceType: record.sourceType,
    fileName,
  }, null, 2)}\n`, 'utf8')

  doc.entries[archiveId] = entry
  writeDocument(doc)
  incrementTelegramArchiveRef(record.resourceKey)
  logger.info('Telegram resource archived', { archiveId, size: expectedSize })
  return entry
}

/** 打开归档目录（不存在时先建）：与平台其它工具一致，路径由主进程决定 */
export async function openTelegramArchiveDir(): Promise<boolean> {
  const absolute = path.resolve(getTelegramArchiveRoot())
  await mkdir(absolute, { recursive: true })
  const errorMessage = await shell.openPath(absolute)
  if (errorMessage) throw new Error(errorMessage)
  return true
}
