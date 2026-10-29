// 消息级缓存（v4）：messages/<acc>/<peer>/<mid>/ + archive.meta.json（进行中）+ manifest.json（完成）
//
// 设计要点：
// - 目录只由数值 id 生成；群名/用户名/原始文件名只进 manifest 快照；
// - `.part` 只接受连续前缀（offset 超过当前大小就丢弃），完成后 rename + SHA-256 + 对象库硬链；
// - manifest.json 是唯一的"完成标记"；archive.meta.json 只表示进行中；
// - 媒体索引（config/media-index.json）给 /media/<mediaKey> 与播放路径使用；
// - 任何远端错误都不在这里触发删除（R5）。
import type {
  TelegramArchivePrepareRequest,
  TelegramArchivePrepareResponse,
  TelegramAttachmentState,
  TelegramMediaLinkMode,
  TelegramMessageAttachment,
  TelegramMessageManifest,
  TelegramMessagePeerSnapshot,
  TelegramMessageState,
  TelegramMessageStatusEntry,
} from '../../../../shared/telegram-cache.ts'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, linkSync, statSync } from 'node:fs'
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import {
  getTelegramMediaIndexPath,
  getTelegramMessageIndexRoot,
  getTelegramMessagesRoot,
  getTelegramObjectsDir,
  resolveTelegramRelativePath,
  toTelegramRelativePath,
} from '../utils/paths.ts'

const DEFAULT_ACCOUNT_SCOPE = 'acc-default'
const MANIFEST_FILE = 'manifest.json'
const META_FILE = 'archive.meta.json'
const TEXT_FILE = 'text.md'
const MEDIA_DIR = 'media'

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

interface MessageMetaAttachment {
  index: number
  mediaKey: string
  kind: string
  mimeType?: string
  fileName?: string
  expectedSize?: number
  actualSize?: number
  sha256?: string
  relativePath?: string
  linkMode?: TelegramMediaLinkMode
  status: TelegramAttachmentState
  received?: number
}

interface MessageMetaDocument {
  schemaVersion: 1
  peer: TelegramMessagePeerSnapshot
  messageId: number
  groupedId?: string
  date?: string
  editDate?: string
  sender?: { id?: string, name?: string }
  createdAt: number
  updatedAt: number
  attachments: MessageMetaAttachment[]
}

interface MessageIndexEntry {
  state: TelegramMessageState
  attachments: number
  size?: number
  savedAt?: number
  updatedAt: number
}

interface MessageIndexDocument {
  schemaVersion: 1
  messages: Record<string, MessageIndexEntry>
}

interface MediaIndexEntry {
  relativePath: string
  size: number
  mimeType?: string
  sha256?: string
  updatedAt: number
}

interface MediaIndexDocument {
  schemaVersion: 1
  media: Record<string, MediaIndexEntry>
}

export interface TelegramMediaRecord {
  mediaKey: string
  absolutePath: string
  relativePath: string
  size: number
  mimeType?: string
  sha256?: string
}

function assertPeerId(peerId: string): string {
  if (!/^-?\d{1,20}$/.test(peerId)) throw new Error('peer id 非法')
  return peerId
}

function assertMessageId(messageId: number): number {
  if (!Number.isSafeInteger(messageId) || messageId <= 0) throw new Error('message id 非法')
  return messageId
}

function assertAccountScope(value: string | undefined): string {
  if (!value) return DEFAULT_ACCOUNT_SCOPE
  if (!/^acc-[\w-]{1,40}$/.test(value)) throw new Error('account scope 非法')
  return value
}

function assertAttachmentIndex(index: number): number {
  if (!Number.isSafeInteger(index) || index <= 0 || index > 999) throw new Error('附件序号非法')
  return index
}

function padMessageId(messageId: number): string {
  return String(messageId).padStart(15, '0')
}

function padAttachmentIndex(index: number): string {
  return String(index).padStart(3, '0')
}

function extensionFor(mimeType: string | undefined, fileName?: string): string {
  if (mimeType && EXTENSION_BY_MIME[mimeType]) return EXTENSION_BY_MIME[mimeType]
  const fromName = fileName ? path.extname(fileName).toLowerCase() : ''
  if (/^\.[a-z0-9]{1,8}$/.test(fromName)) return fromName
  return '.bin'
}

export function buildTelegramMessageKey(peerId: string, messageId: number): string {
  return `tgmsg:v1:${peerId}:${messageId}`
}

export function telegramMessageDir(peerId: string, messageId: number, accountScope?: string): string {
  return path.join(
    getTelegramMessagesRoot(),
    assertAccountScope(accountScope),
    `peer-${assertPeerId(peerId)}`,
    padMessageId(assertMessageId(messageId)),
  )
}

function metaPath(dir: string): string {
  return path.join(dir, META_FILE)
}

function manifestPath(dir: string): string {
  return path.join(dir, MANIFEST_FILE)
}

function attachmentFileName(attachment: Pick<MessageMetaAttachment, 'index' | 'mimeType' | 'fileName'>): string {
  return `${padAttachmentIndex(assertAttachmentIndex(attachment.index))}${extensionFor(attachment.mimeType, attachment.fileName)}`
}

function attachmentFinalPath(dir: string, attachment: Pick<MessageMetaAttachment, 'index' | 'mimeType' | 'fileName'>): string {
  return path.join(dir, MEDIA_DIR, attachmentFileName(attachment))
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.tmp`
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await rename(tempPath, filePath)
}

async function writeTextAtomic(filePath: string, text: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.tmp`
  await writeFile(tempPath, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
  await rename(tempPath, filePath)
}

function safeFileSize(filePath: string): number | undefined {
  try {
    const info = statSync(filePath)
    return info.isFile() ? info.size : undefined
  } catch {
    return undefined
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

function readMediaIndex(): MediaIndexDocument {
  const document = readJsonDocument<MediaIndexDocument>(getTelegramMediaIndexPath(), () => ({
    schemaVersion: 1,
    media: {},
  }))
  return document && typeof document.media === 'object' && document.media !== null
    ? { schemaVersion: 1, media: document.media }
    : { schemaVersion: 1, media: {} }
}

export function recordTelegramMedia(input: {
  mediaKey: string
  relativePath: string
  size: number
  mimeType?: string
  sha256?: string
}): void {
  if (!/^[\w.-]{1,200}$/.test(input.mediaKey)) return
  const document = readMediaIndex()
  document.media[input.mediaKey] = {
    relativePath: input.relativePath,
    size: input.size,
    mimeType: input.mimeType,
    sha256: input.sha256,
    updatedAt: Date.now(),
  }
  writeJsonDocument(getTelegramMediaIndexPath(), document)
}

export function resolveTelegramMediaRecord(mediaKey: string): TelegramMediaRecord | undefined {
  if (!/^[\w.-]{1,200}$/.test(mediaKey)) return undefined
  const entry = readMediaIndex().media[mediaKey]
  if (!entry) return undefined
  const absolutePath = resolveTelegramRelativePath(entry.relativePath)
  const size = safeFileSize(absolutePath)
  if (size === undefined) return undefined
  return {
    mediaKey,
    absolutePath,
    relativePath: entry.relativePath,
    size,
    mimeType: entry.mimeType,
    sha256: entry.sha256,
  }
}

export function removeTelegramMedia(mediaKey: string): void {
  if (!/^[\w.-]{1,200}$/.test(mediaKey)) return
  const document = readMediaIndex()
  if (!document.media[mediaKey]) return
  delete document.media[mediaKey]
  writeJsonDocument(getTelegramMediaIndexPath(), document)
}

function indexDocumentFor(peerId: string): { filePath: string, document: MessageIndexDocument } {
  const filePath = path.join(getTelegramMessageIndexRoot(), DEFAULT_ACCOUNT_SCOPE, `peer-${assertPeerId(peerId)}.json`)
  const document = readJsonDocument<MessageIndexDocument>(filePath, () => ({ schemaVersion: 1, messages: {} }))
  return {
    filePath,
    document: document && typeof document.messages === 'object' && document.messages !== null
      ? { schemaVersion: 1, messages: document.messages }
      : { schemaVersion: 1, messages: {} },
  }
}

function updateMessageIndex(peerId: string, messageId: number, entry: MessageIndexEntry): void {
  const { filePath, document } = indexDocumentFor(peerId)
  document.messages[String(messageId)] = entry
  writeJsonDocument(filePath, document)
}

export function removeTelegramMessageIndexEntry(peerId: string, messageId: number): void {
  const { filePath, document } = indexDocumentFor(peerId)
  if (!document.messages[String(messageId)]) return
  delete document.messages[String(messageId)]
  writeJsonDocument(filePath, document)
}

export async function readTelegramMessageManifest(
  peerId: string,
  messageId: number,
  accountScope?: string,
): Promise<TelegramMessageManifest | undefined> {
  const dir = telegramMessageDir(peerId, messageId, accountScope)
  return readJsonFile<TelegramMessageManifest>(manifestPath(dir))
}

export interface TelegramMessageMediaItem {
  mediaKey: string
  mimeType?: string
  fileName?: string
  size: number
  relativePath: string
}

/** 一条消息可播放/可打开的媒体清单（影库内置播放用） */
export async function listTelegramMessageMedia(peerId: string, messageId: number): Promise<TelegramMessageMediaItem[]> {
  const manifest = await readTelegramMessageManifest(peerId, messageId)
  if (!manifest) return []
  return manifest.attachments.map(attachment => ({
    mediaKey: attachment.mediaKey,
    mimeType: attachment.mimeType,
    fileName: attachment.fileName,
    size: attachment.actualSize ?? 0,
    relativePath: attachment.relativePath ?? '',
  }))
}

async function readMeta(dir: string): Promise<MessageMetaDocument | undefined> {
  const meta = await readJsonFile<MessageMetaDocument>(metaPath(dir))
  if (!meta || meta.schemaVersion !== 1 || !Array.isArray(meta.attachments)) return undefined
  return meta
}

async function writeMeta(dir: string, meta: MessageMetaDocument): Promise<void> {
  meta.updatedAt = Date.now()
  await writeJsonAtomic(metaPath(dir), meta)
}

function toAttachment(metaAttachment: MessageMetaAttachment): TelegramMessageAttachment {
  return {
    index: metaAttachment.index,
    mediaKey: metaAttachment.mediaKey,
    kind: metaAttachment.kind,
    mimeType: metaAttachment.mimeType,
    fileName: metaAttachment.fileName,
    expectedSize: metaAttachment.expectedSize,
    actualSize: metaAttachment.actualSize,
    sha256: metaAttachment.sha256,
    relativePath: metaAttachment.relativePath,
    linkMode: metaAttachment.linkMode,
    status: metaAttachment.status,
  }
}

function progressOf(meta: MessageMetaDocument): { received: number, expected: number } {
  let received = 0
  let expected = 0
  for (const attachment of meta.attachments) {
    received += attachment.status === 'complete' ? attachment.actualSize ?? 0 : attachment.received ?? 0
    expected += attachment.expectedSize ?? 0
  }
  return { received, expected }
}

/** 幂等：已完成直接返回 complete；进行中补齐/合并附件清单；否则新建 archive.meta.json */
export async function prepareTelegramMessage(
  request: TelegramArchivePrepareRequest,
  accountScope?: string,
): Promise<TelegramArchivePrepareResponse> {
  assertPeerId(request.peer.id)
  assertMessageId(request.messageId)
  const dir = telegramMessageDir(request.peer.id, request.messageId, accountScope)

  const existingManifest = await readJsonFile<TelegramMessageManifest>(manifestPath(dir))
  if (existingManifest?.status === 'complete') {
    return {
      state: 'complete',
      attachments: existingManifest.attachments.map(attachment => ({
        index: attachment.index,
        mediaKey: attachment.mediaKey,
        received: attachment.actualSize ?? 0,
        expected: attachment.expectedSize ?? attachment.actualSize ?? 0,
        complete: true,
      })),
    }
  }

  await mkdir(path.join(dir, MEDIA_DIR), { recursive: true })
  const now = Date.now()
  const meta: MessageMetaDocument = (await readMeta(dir)) ?? {
    schemaVersion: 1,
    peer: request.peer,
    messageId: request.messageId,
    createdAt: now,
    updatedAt: now,
    attachments: [],
  }
  meta.peer = { ...meta.peer, ...request.peer }
  meta.groupedId = request.groupedId ?? meta.groupedId
  meta.date = request.date ?? meta.date
  meta.editDate = request.editDate ?? meta.editDate
  meta.sender = request.sender ?? meta.sender

  for (const incoming of request.attachments) {
    assertAttachmentIndex(incoming.index)
    if (!/^[\w.-]{1,200}$/.test(incoming.mediaKey)) throw new Error('mediaKey 非法')

    let attachment = meta.attachments.find(item => item.index === incoming.index)
    if (!attachment) {
      attachment = {
        index: incoming.index,
        mediaKey: incoming.mediaKey,
        kind: incoming.kind,
        status: 'pending',
      }
      meta.attachments.push(attachment)
    }
    attachment.mediaKey = incoming.mediaKey
    attachment.kind = incoming.kind
    attachment.mimeType = incoming.mimeType ?? attachment.mimeType
    attachment.fileName = incoming.fileName ?? attachment.fileName
    attachment.expectedSize = incoming.expectedSize ?? attachment.expectedSize

    const finalPath = attachmentFinalPath(dir, attachment)
    const finalSize = safeFileSize(finalPath)
    if (finalSize !== undefined) {
      attachment.status = 'complete'
      attachment.actualSize = finalSize
      attachment.relativePath = toTelegramRelativePath(finalPath)
      continue
    }
    const partSize = safeFileSize(`${finalPath}.part`)
    attachment.received = partSize ?? 0
    attachment.status = partSize && partSize > 0 ? 'partial' : 'pending'
  }

  meta.attachments.sort((left, right) => left.index - right.index)
  await writeMeta(dir, meta)
  const { received } = progressOf(meta)
  updateMessageIndex(meta.peer.id, meta.messageId, {
    state: meta.attachments.some(item => item.status === 'partial') ? 'partial' : 'queued',
    attachments: meta.attachments.length,
    size: received,
    updatedAt: now,
  })

  return {
    // 附件都已落盘但 manifest.json 还没写：仍是进行中，必须再 commit
    state: 'partial',
    attachments: meta.attachments.map(attachment => ({
      index: attachment.index,
      mediaKey: attachment.mediaKey,
      received: attachment.status === 'complete' ? attachment.actualSize ?? 0 : attachment.received ?? 0,
      expected: attachment.expectedSize ?? 0,
      complete: attachment.status === 'complete',
    })),
  }
}

async function linkObjectIntoMessage(finalPath: string, sha256: string): Promise<TelegramMediaLinkMode> {
  const objectPath = path.join(getTelegramObjectsDir(), sha256.slice(0, 2), sha256)
  await mkdir(path.dirname(objectPath), { recursive: true })

  if (!existsSync(objectPath)) {
    try {
      linkSync(finalPath, objectPath)
      return 'hardlink'
    } catch {
      // 跨卷或不支持硬链：对象库放一份副本，消息目录保留自己的文件
      await copyFile(finalPath, objectPath)
      return 'copy'
    }
  }

  // 对象已存在：用硬链替换消息目录里的副本（同卷零额外空间）；失败则保留副本
  const tempLink = `${finalPath}.link-${process.pid}`
  try {
    await rm(tempLink, { force: true })
    linkSync(objectPath, tempLink)
    await rm(finalPath, { force: true })
    await rename(tempLink, finalPath)
    return 'hardlink'
  } catch {
    await rm(tempLink, { force: true }).catch(() => undefined)
    return 'copy'
  }
}

async function finalizeAttachment(dir: string, meta: MessageMetaDocument, attachment: MessageMetaAttachment): Promise<void> {
  const finalPath = attachmentFinalPath(dir, attachment)
  const partPath = `${finalPath}.part`

  if (!existsSync(partPath)) {
    if (safeFileSize(finalPath) === undefined) throw new Error('没有可提交的分片')
  } else {
    if (existsSync(finalPath)) await rm(finalPath, { force: true })
    await rename(partPath, finalPath)
  }

  const size = (await stat(finalPath)).size
  const sha256 = await sha256File(finalPath)
  const linkMode = await linkObjectIntoMessage(finalPath, sha256)

  attachment.status = 'complete'
  attachment.actualSize = size
  attachment.sha256 = sha256
  attachment.relativePath = toTelegramRelativePath(finalPath)
  attachment.linkMode = linkMode
  attachment.received = size

  recordTelegramMedia({
    mediaKey: attachment.mediaKey,
    relativePath: attachment.relativePath,
    size,
    mimeType: attachment.mimeType,
    sha256,
  })
  await writeMeta(dir, meta)
}

/** 追加分片；offset 超过当前大小视为跳写（丢弃），保持连续前缀 */
export async function appendTelegramAttachment(input: {
  peerId: string
  messageId: number
  index: number
  offset: number
  data: Buffer
  complete?: boolean
  accountScope?: string
}): Promise<{ received: number, expected: number, complete: boolean }> {
  assertPeerId(input.peerId)
  assertMessageId(input.messageId)
  const index = assertAttachmentIndex(input.index)
  if (!Number.isSafeInteger(input.offset) || input.offset < 0) throw new Error('offset 非法')

  const dir = telegramMessageDir(input.peerId, input.messageId, input.accountScope)
  const meta = await readMeta(dir)
  if (!meta) throw new Error('消息尚未 prepare')
  const attachment = meta.attachments.find(item => item.index === index)
  if (!attachment) throw new Error('附件不存在')

  const finalPath = attachmentFinalPath(dir, attachment)
  const partPath = `${finalPath}.part`
  await mkdir(path.dirname(finalPath), { recursive: true })
  if (!existsSync(partPath)) await writeFile(partPath, Buffer.alloc(0))

  const current = safeFileSize(partPath) ?? 0
  const expected = attachment.expectedSize ?? 0
  if (input.offset > current) {
    return { received: current, expected, complete: false }
  }

  if (input.data.length > 0) {
    const handle = await open(partPath, 'r+')
    try {
      let written = 0
      while (written < input.data.length) {
        const { bytesWritten } = await handle.write(
          input.data,
          written,
          input.data.length - written,
          input.offset + written,
        )
        if (!bytesWritten) throw new Error('写入分片失败')
        written += bytesWritten
      }
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  const received = safeFileSize(partPath) ?? 0
  const complete = Boolean(input.complete) || (expected > 0 && received >= expected)
  if (complete) {
    await finalizeAttachment(dir, meta, attachment)
    return { received: attachment.actualSize ?? received, expected: expected || received, complete: true }
  }

  attachment.status = received > 0 ? 'partial' : 'pending'
  attachment.received = received
  await writeMeta(dir, meta)
  const { received: totalReceived } = progressOf(meta)
  updateMessageIndex(meta.peer.id, meta.messageId, {
    state: 'partial',
    attachments: meta.attachments.length,
    size: totalReceived,
    updatedAt: Date.now(),
  })
  return { received, expected, complete: false }
}

/** 完成归档：所有附件 complete 才写 manifest.json / text.md（完成标记） */
export async function commitTelegramMessage(input: {
  peerId: string
  messageId: number
  text?: string
  textTruncated?: boolean
  accountScope?: string
}): Promise<{ state: TelegramMessageState, manifest?: TelegramMessageManifest }> {
  assertPeerId(input.peerId)
  assertMessageId(input.messageId)
  const dir = telegramMessageDir(input.peerId, input.messageId, input.accountScope)
  const meta = await readMeta(dir)
  if (!meta) throw new Error('消息尚未 prepare')

  const incomplete = meta.attachments.filter(item => item.status !== 'complete')
  if (incomplete.length > 0) {
    const { received } = progressOf(meta)
    updateMessageIndex(meta.peer.id, meta.messageId, {
      state: 'partial',
      attachments: meta.attachments.length,
      size: received,
      updatedAt: Date.now(),
    })
    return { state: 'partial' }
  }

  const text = input.text ?? ''
  if (text) await writeTextAtomic(path.join(dir, TEXT_FILE), text)

  const now = Date.now()
  const manifest: TelegramMessageManifest = {
    schemaVersion: 1,
    messageKey: buildTelegramMessageKey(meta.peer.id, meta.messageId),
    peer: meta.peer,
    messageId: meta.messageId,
    groupedId: meta.groupedId,
    date: meta.date,
    editDate: meta.editDate,
    senderSnapshot: meta.sender,
    text: text
      ? { saved: true, chars: text.length, truncated: Boolean(input.textTruncated), file: TEXT_FILE }
      : undefined,
    status: 'complete',
    attachments: meta.attachments.map(toAttachment),
    savedAt: now,
    updatedAt: now,
  }
  await writeJsonAtomic(manifestPath(dir), manifest)
  await rm(metaPath(dir), { force: true })
  for (const attachment of meta.attachments) {
    await rm(`${attachmentFinalPath(dir, attachment)}.part`, { force: true }).catch(() => undefined)
  }
  updateMessageIndex(meta.peer.id, meta.messageId, {
    state: 'complete',
    attachments: meta.attachments.length,
    size: meta.attachments.reduce((total, item) => total + (item.actualSize ?? 0), 0),
    savedAt: now,
    updatedAt: now,
  })
  return { state: 'complete', manifest }
}

export async function getTelegramMessageStatuses(
  peerId: string,
  messageIds: number[],
): Promise<Record<string, TelegramMessageStatusEntry>> {
  const statuses: Record<string, TelegramMessageStatusEntry> = {}
  for (const messageId of messageIds) {
    const key = String(messageId)
    try {
      const dir = telegramMessageDir(peerId, messageId)
      const manifest = await readJsonFile<TelegramMessageManifest>(manifestPath(dir))
      if (manifest?.status === 'complete') {
        statuses[key] = {
          state: 'complete',
          attachments: manifest.attachments.length,
          savedAt: manifest.savedAt,
          received: manifest.attachments.reduce((total, item) => total + (item.actualSize ?? 0), 0),
          expected: manifest.attachments.reduce((total, item) => total + (item.expectedSize ?? item.actualSize ?? 0), 0),
          progress: 1,
        }
        continue
      }
      const meta = await readMeta(dir)
      if (meta) {
        const { received, expected } = progressOf(meta)
        statuses[key] = {
          state: 'partial',
          attachments: meta.attachments.length,
          received,
          expected,
          progress: expected > 0 ? Math.min(1, received / expected) : 0,
        }
        continue
      }
      statuses[key] = { state: 'missing' }
    } catch {
      statuses[key] = { state: 'failed', error: '无法读取消息索引' }
    }
  }
  return statuses
}

/** 媒体索引里的批量状态（/api/media/status 用） */
export function getTelegramMediaStatuses(keys: string[]): Record<string, TelegramMessageStatusEntry> {
  const statuses: Record<string, TelegramMessageStatusEntry> = {}
  for (const key of keys) {
    const record = resolveTelegramMediaRecord(key)
    statuses[key] = record
      ? { state: 'complete', received: record.size, expected: record.size, progress: 1 }
      : { state: 'missing' }
  }
  return statuses
}
