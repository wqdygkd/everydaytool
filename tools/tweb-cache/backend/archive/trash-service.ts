// 回收站（v4）：删除 = 目录整体移入 <assets>/tweb-cache/trash/<时间>_<peer>_<mid>/，
// 写 trash.json（删除时间 / 原路径 / 到期时间）；恢复 = 原路径移回并重建媒体索引。
import type { ArchiveMessageManifest, ArchiveMessageState, ArchiveTrashEntry } from '../../../../shared/media-archive.ts'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { logger } from '../../../../backend/utils/logger.ts'
import {
  archiveMessageDir,
  readArchiveMessageManifest,
  recordArchiveMedia,
  removeArchiveMedia,
  removeArchiveMessageIndexEntry,
} from './message-store.ts'
import { getArchiveTrashRoot, toArchiveRelativePath } from './paths.ts'

interface TrashDocument extends ArchiveTrashEntry {
  schemaVersion: 1
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function trashIdFor(peerId: string, messageId: number, now: number): string {
  const date = new Date(now)
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    + `-${String(now % 1000).padStart(3, '0')}`
  return `${stamp}_peer-${peerId}_${String(messageId).padStart(15, '0')}`
}

async function readTrashDocument(dir: string): Promise<TrashDocument | undefined> {
  try {
    const raw = await readFile(path.join(dir, 'trash.json'), 'utf8')
    const parsed = JSON.parse(raw) as TrashDocument
    return parsed.schemaVersion === 1 ? parsed : undefined
  } catch {
    return undefined
  }
}

export async function moveArchiveMessageToTrash(
  peerId: string,
  messageId: number,
  retentionDays = 30,
): Promise<ArchiveTrashEntry> {
  const source = archiveMessageDir(peerId, messageId)
  if (!existsSync(source)) throw new Error('本地没有该消息缓存')

  const manifest = await readArchiveMessageManifest(peerId, messageId)
  const now = Date.now()
  const trashId = trashIdFor(peerId, messageId, now)
  const target = path.join(getArchiveTrashRoot(), trashId)
  await mkdir(path.dirname(target), { recursive: true })
  await rename(source, target)

  const entry: ArchiveTrashEntry = {
    trashId,
    deletedAt: now,
    expiresAt: now + Math.max(0, retentionDays) * 24 * 60 * 60 * 1000,
    originalPath: toArchiveRelativePath(source),
    peerId,
    messageId,
  }
  await writeFile(
    path.join(target, 'trash.json'),
    `${JSON.stringify({ schemaVersion: 1, ...entry }, null, 2)}\n`,
    'utf8',
  )

  for (const attachment of manifest?.attachments ?? []) {
    if (attachment.mediaKey) removeArchiveMedia(attachment.mediaKey)
  }
  removeArchiveMessageIndexEntry(peerId, messageId)
  logger.info('Archive message moved to trash', { peerId, messageId, trashId })
  return entry
}

export async function listArchiveTrash(): Promise<ArchiveTrashEntry[]> {
  const root = getArchiveTrashRoot()
  if (!existsSync(root)) return []
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const result: ArchiveTrashEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const document = await readTrashDocument(path.join(root, entry.name))
    if (!document) continue
    result.push({
      trashId: document.trashId,
      deletedAt: document.deletedAt,
      expiresAt: document.expiresAt,
      originalPath: document.originalPath,
      peerId: document.peerId,
      messageId: document.messageId,
    })
  }
  return result.sort((left, right) => right.deletedAt - left.deletedAt)
}

export async function restoreArchiveTrash(trashId: string): Promise<{
  state: ArchiveMessageState
  peerId: string
  messageId: number
}> {
  const trashDir = path.join(getArchiveTrashRoot(), trashId)
  const document = await readTrashDocument(trashDir)
  if (!document) throw new Error('回收站条目不存在')

  const manifest = await readTrashJsonManifest(trashDir)
  // 目录已不再带 acc-<scope> 这一级：恢复位置按 peerId / messageId 重新算，旧 originalPath 只作记录
  const target = archiveMessageDir(document.peerId, document.messageId)
  if (existsSync(target)) throw new Error('原路径已被占用，无法恢复')

  await mkdir(path.dirname(target), { recursive: true })
  await rename(trashDir, target)
  await rm(path.join(target, 'trash.json'), { force: true }).catch(() => undefined)

  for (const attachment of manifest?.attachments ?? []) {
    if (!attachment.mediaKey || !attachment.relativePath) continue
    recordArchiveMedia({
      mediaKey: attachment.mediaKey,
      relativePath: attachment.relativePath,
      size: attachment.actualSize ?? 0,
      mimeType: attachment.mimeType,
      sha256: attachment.sha256,
    })
  }
  logger.info('Archive message restored from trash', { trashId })
  return {
    state: manifest ? 'complete' : 'partial',
    peerId: document.peerId,
    messageId: document.messageId,
  }
}

async function readTrashJsonManifest(dir: string): Promise<ArchiveMessageManifest | undefined> {
  try {
    const raw = await readFile(path.join(dir, 'manifest.json'), 'utf8')
    const parsed = JSON.parse(raw) as ArchiveMessageManifest
    return parsed.schemaVersion === 1 ? parsed : undefined
  } catch {
    return undefined
  }
}

/** 清理到期条目；返回删除数量。默认只删已到期（expiresAt <= now）。 */
export async function emptyArchiveTrash(olderThanDays?: number): Promise<number> {
  const root = getArchiveTrashRoot()
  const entries = await listArchiveTrash()
  const now = Date.now()
  let removed = 0
  for (const entry of entries) {
    const expired = olderThanDays === undefined
      ? entry.expiresAt <= now
      : entry.deletedAt <= now - Math.max(0, olderThanDays) * 24 * 60 * 60 * 1000
    if (!expired) continue
    try {
      await rm(path.join(root, entry.trashId), { recursive: true, force: true })
      removed += 1
    } catch (error) {
      logger.warn('Failed to remove trash entry', { trashId: entry.trashId, error: (error as Error).message })
    }
  }
  return removed
}
