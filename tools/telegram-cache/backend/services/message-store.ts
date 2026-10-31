// 消息级缓存（v4）：messages/peer-<群 id>/<消息 id 补零 15 位>/message.md + media/<mediaKey>.<ext>
//
// 设计要点：
// - 目录就是「群 id / 消息 id / 消息内容」三级：peer-<id> → 补零消息 id → message.md + media/；
// - 目录只由数值 id 生成（不受群名/文件名影响）；群名、发送者、正文写进 message.md 与 manifest 快照；
// - 旧版 `messages/acc-<scope>/…` 那一级（多账号占位，从未接线）会在首次扫描时上移一级并删除；
// - 媒体文件名取 mediaKey（`photo_<id>` / `document_<id>`），一眼可辨归属；旧版 `001.jpg` 会在 prepare 时迁移；
// - `.part` 只接受连续前缀（offset 超过当前大小就丢弃），完成后 rename + SHA-256 + 对象库硬链；
// - manifest.json 是唯一的"完成标记"；archive.meta.json 只表示进行中；
// - 媒体索引（config/media-index.json）给 /media/<mediaKey> 与播放路径使用；
// - 任何远端错误都不在这里触发删除（R5）。
import type {
  TelegramArchivePrepareRequest,
  TelegramArchivePrepareResponse,
  TelegramAttachmentState,
  TelegramForwardSourceSnapshot,
  TelegramMediaLinkMode,
  TelegramMessageAttachment,
  TelegramMessageManifest,
  TelegramMessagePeerSnapshot,
  TelegramMessageState,
  TelegramMessageStatusEntry,
  TelegramThumbnailSnapshot,
} from '../../../../shared/telegram-cache.ts'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, linkSync, statSync } from 'node:fs'
import { copyFile, mkdir, open, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
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

/** 旧版多账号占位目录名（`acc-default` 等）：迁移时上移一级后删除 */
const LEGACY_ACCOUNT_DIR = /^acc-[\w-]{1,40}$/
const MANIFEST_FILE = 'manifest.json'
const META_FILE = 'archive.meta.json'
/** 消息内容快照（群名/发送者/时间/正文/附件清单），进行中也会写 */
const CONTENT_FILE = 'message.md'
/** v4 早期版本只写正文；准备阶段优先复用，避免重复下载 */
const LEGACY_TEXT_FILE = 'text.md'
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
  forwardSource?: TelegramForwardSourceSnapshot
  thumbnail?: TelegramThumbnailSnapshot
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

export function telegramMessageDir(peerId: string, messageId: number): string {
  return path.join(
    getTelegramMessagesRoot(),
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

const MEDIA_KEY_FILE_NAME = /^[\w.-]{1,120}$/

function attachmentFileName(
  attachment: Pick<MessageMetaAttachment, 'index' | 'mediaKey' | 'mimeType' | 'fileName'>,
): string {
  const extension = extensionFor(attachment.mimeType, attachment.fileName)
  const mediaKey = attachment.mediaKey ?? ''
  // 文件名用媒体键（`photo_<id>` / `document_<id>`）：目录里直接能看出这条消息缓存了什么
  if (MEDIA_KEY_FILE_NAME.test(mediaKey)) return `${mediaKey}${extension}`
  return `${padAttachmentIndex(assertAttachmentIndex(attachment.index))}${extension}`
}

/** v4 早期命名（`001.jpg`），只用于把旧归档迁到 mediaKey 命名 */
function legacyAttachmentFinalPath(
  dir: string,
  attachment: Pick<MessageMetaAttachment, 'index' | 'mimeType' | 'fileName'>,
): string {
  const name = `${padAttachmentIndex(assertAttachmentIndex(attachment.index))}${extensionFor(attachment.mimeType, attachment.fileName)}`
  return path.join(dir, MEDIA_DIR, name)
}

function attachmentFinalPath(
  dir: string,
  attachment: Pick<MessageMetaAttachment, 'index' | 'mediaKey' | 'mimeType' | 'fileName'>,
): string {
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

function describePeer(peer: TelegramMessagePeerSnapshot): string {
  if (peer.titleSnapshot) return peer.titleSnapshot
  if (peer.username) return `@${peer.username}`
  return `peer ${peer.id}`
}

function describeAttachment(attachment: MessageMetaAttachment): string {
  const name = attachment.relativePath?.split('/').pop() ?? attachmentFileName(attachment)
  const size = attachment.actualSize ?? attachment.expectedSize ?? attachment.received ?? 0
  return `${name}（${attachment.mediaKey}，${formatSize(size)}）`
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`
}

/** 消息内容快照：群名/发送者/时间等头部 + 正文，让「消息 id」目录本身说明缓存了什么 */
function buildContentMarkdown(meta: MessageMetaDocument, text: string, textTruncated: boolean): string {
  const lines: string[] = [
    `# ${describePeer(meta.peer)}`,
    '',
    `- 会话 id：${meta.peer.id}`,
  ]
  if (meta.peer.username) lines.push(`- 用户名：@${meta.peer.username}`)
  if (meta.peer.type) lines.push(`- 会话类型：${meta.peer.type}`)
  lines.push(`- 消息 id：${meta.messageId}`)
  if (meta.date) lines.push(`- 发送时间：${meta.date}`)
  if (meta.editDate) lines.push(`- 编辑时间：${meta.editDate}`)
  if (meta.sender?.name) {
    lines.push(`- 发送者：${meta.sender.name}${meta.sender.id ? `（${meta.sender.id}）` : ''}`)
  }
  if (meta.forwardSource) {
    const source = meta.forwardSource
    const name = source.titleSnapshot || source.name || source.username || source.id || '未知来源'
    const suffix = source.messageId ? `（消息 ${source.messageId}）` : ''
    lines.push(`- 转发来源：${name}${suffix}`)
  }
  if (meta.groupedId) lines.push(`- 相册：${meta.groupedId}`)
  if (meta.attachments.length > 0) {
    lines.push(`- 媒体：${meta.attachments.map(describeAttachment).join('、')}`)
  }
  lines.push('', text || '（无正文）')
  if (textTruncated) lines.push('', '> 正文过长，已按上限截断保存。')
  return lines.join('\n')
}

async function writeContentSnapshot(
  dir: string,
  meta: MessageMetaDocument,
  text: string,
  textTruncated: boolean,
): Promise<void> {
  await writeTextAtomic(path.join(dir, CONTENT_FILE), buildContentMarkdown(meta, text, textTruncated))
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
  const filePath = path.join(getTelegramMessageIndexRoot(), `peer-${assertPeerId(peerId)}.json`)
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
): Promise<TelegramMessageManifest | undefined> {
  const dir = telegramMessageDir(peerId, messageId)
  return readJsonFile<TelegramMessageManifest>(manifestPath(dir))
}

export interface TelegramMessageMediaItem {
  mediaKey: string
  mimeType?: string
  fileName?: string
  size: number
  relativePath: string
}

/** manifest（已完成）→ meta 形状，供重建 message.md 时复用同一套抬头 */
function manifestAsMeta(manifest: TelegramMessageManifest): MessageMetaDocument {
  return {
    schemaVersion: 1,
    peer: manifest.peer,
    messageId: manifest.messageId,
    groupedId: manifest.groupedId,
    date: manifest.date,
    editDate: manifest.editDate,
    sender: manifest.senderSnapshot,
    forwardSource: manifest.forwardSource,
    thumbnail: manifest.thumbnail,
    createdAt: manifest.savedAt,
    updatedAt: manifest.updatedAt,
    attachments: manifest.attachments.map(attachment => ({
      index: attachment.index,
      mediaKey: attachment.mediaKey,
      kind: attachment.kind,
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
      expectedSize: attachment.expectedSize,
      actualSize: attachment.actualSize,
      sha256: attachment.sha256,
      relativePath: attachment.relativePath,
      linkMode: attachment.linkMode,
      status: attachment.status,
    })),
  }
}

/** 补 `message.md`：旧 text.md 改写成带抬头的新文件，实在没有就按快照重建（正文为空） */
async function ensureContentFile(dir: string, toMeta: () => MessageMetaDocument): Promise<number> {
  const contentPath = path.join(dir, CONTENT_FILE)
  if (existsSync(contentPath)) return 0
  const legacyPath = path.join(dir, LEGACY_TEXT_FILE)
  try {
    if (existsSync(legacyPath)) {
      const body = await readFile(legacyPath, 'utf8')
      await writeContentSnapshot(dir, toMeta(), body.trim(), false)
      await rm(legacyPath, { force: true })
      return 1
    }
    await writeContentSnapshot(dir, toMeta(), '', false)
    return 1
  } catch {
    return 0
  }
}

/**
 * 旧目录正名（幂等）：`media/001.jpg` → `media/<mediaKey>.jpg`、`text.md` → `message.md`，
 * 同步回写 manifest/meta 里的 relativePath。返回改动条数，0 表示已经是新布局。
 */
export async function normalizeTelegramMessageNames(
  peerId: string,
  messageId: number,
): Promise<number> {
  const dir = telegramMessageDir(peerId, messageId)
  let changed = 0

  const manifest = await readJsonFile<TelegramMessageManifest>(manifestPath(dir))
  if (manifest && Array.isArray(manifest.attachments)) {
    for (const attachment of manifest.attachments) {
      const renamed = await migrateLegacyAttachmentFile(dir, attachment)
      const finalPath = attachmentFinalPath(dir, attachment)
      if (!existsSync(finalPath)) continue
      // 顺带把旧 `acc-<scope>/` 期间的 relativePath 改回新布局（文件已存在才写）
      const expectedPath = toTelegramRelativePath(finalPath)
      if (!renamed && attachment.relativePath === expectedPath) continue
      attachment.relativePath = expectedPath
      changed += 1
    }
    changed += await ensureContentFile(dir, () => manifestAsMeta(manifest))
    if (changed > 0) {
      if (manifest.text) manifest.text.file = CONTENT_FILE
      manifest.updatedAt = Date.now()
      await writeJsonAtomic(manifestPath(dir), manifest)
    }
    return changed
  }

  const meta = await readMeta(dir)
  if (!meta) return 0
  for (const attachment of meta.attachments) {
    const renamed = await migrateLegacyAttachmentFile(dir, attachment)
    const finalPath = attachmentFinalPath(dir, attachment)
    if (!existsSync(finalPath)) continue
    const expectedPath = toTelegramRelativePath(finalPath)
    if (!renamed && attachment.relativePath === expectedPath) continue
    attachment.relativePath = expectedPath
    changed += 1
  }
  changed += await ensureContentFile(dir, () => meta)
  if (changed > 0) await writeMeta(dir, meta)
  return changed
}

export interface TelegramNormalizeSummary {
  messages: number
  changed: number
  /** 从旧 `acc-<scope>/` 目录上移过来的消息数 */
  migrated: number
}

export interface TelegramAccountMigrationSummary {
  messages: number
  media: number
}

let accountMigration: Promise<TelegramAccountMigrationSummary> | undefined

/** 旧布局迁移（每次进程只跑一次，幂等）：`messages/acc-<scope>/peer-<id>/<mid>/` 上移一级 */
export function migrateTelegramAccountLayout(): Promise<TelegramAccountMigrationSummary> {
  accountMigration ??= runAccountMigration().catch((error: unknown) => {
    accountMigration = undefined
    throw error
  })
  return accountMigration
}

async function runAccountMigration(): Promise<TelegramAccountMigrationSummary> {
  const summary: TelegramAccountMigrationSummary = { messages: 0, media: 0 }
  const messagesRoot = getTelegramMessagesRoot()
  const scopes = await readdir(messagesRoot, { withFileTypes: true }).catch(() => [])
  for (const scope of scopes) {
    if (!scope.isDirectory() || !LEGACY_ACCOUNT_DIR.test(scope.name)) continue
    const scopeRoot = path.join(messagesRoot, scope.name)
    summary.messages += await moveScopeMessagesUp(scopeRoot)
    // 只删空壳：万一有目录改名失败，留在原地的数据不能被递归删掉（下次再试）
    await rmdir(scopeRoot).catch(() => undefined)
  }

  const indexRoot = getTelegramMessageIndexRoot()
  const indexScopes = await readdir(indexRoot, { withFileTypes: true }).catch(() => [])
  for (const scope of indexScopes) {
    if (!scope.isDirectory() || !LEGACY_ACCOUNT_DIR.test(scope.name)) continue
    const scopeRoot = path.join(indexRoot, scope.name)
    const files = await readdir(scopeRoot, { withFileTypes: true }).catch(() => [])
    for (const file of files) {
      if (!file.isFile()) continue
      const target = path.join(indexRoot, file.name)
      if (existsSync(target)) continue
      await rename(path.join(scopeRoot, file.name), target).catch(() => undefined)
    }
    await rmdir(scopeRoot).catch(() => undefined)
  }

  summary.media = rewriteLegacyMediaPaths()
  return summary
}

/** 把一个 `acc-<scope>/` 里的 peer 目录（或其中的消息目录）搬到 messages/ 根下 */
async function moveScopeMessagesUp(scopeRoot: string): Promise<number> {
  let moved = 0
  const peers = await readdir(scopeRoot, { withFileTypes: true }).catch(() => [])
  for (const peer of peers) {
    if (!peer.isDirectory() || !peer.name.startsWith('peer-')) continue
    const source = path.join(scopeRoot, peer.name)
    const targetPeer = path.join(getTelegramMessagesRoot(), peer.name)
    if (!existsSync(targetPeer)) {
      await rename(source, targetPeer).catch(() => undefined)
      const landed = await readdir(targetPeer, { withFileTypes: true }).catch(() => [])
      moved += landed.filter(item => item.isDirectory() && Number(item.name) > 0).length
      continue
    }
    const messages = await readdir(source, { withFileTypes: true }).catch(() => [])
    for (const message of messages) {
      if (!message.isDirectory()) continue
      const targetMessage = path.join(targetPeer, message.name)
      if (Number(message.name) <= 0 || existsSync(targetMessage)) continue
      await rename(path.join(source, message.name), targetMessage).catch(() => undefined)
      moved += 1
    }
  }
  return moved
}

/** media-index 里残留的 `messages/acc-<scope>/…` 相对路径去掉那一级 */
function rewriteLegacyMediaPaths(): number {
  const document = readMediaIndex()
  let changed = 0
  for (const [mediaKey, entry] of Object.entries(document.media)) {
    const relativePath = entry?.relativePath ?? ''
    const segments = relativePath.split('/')
    if (segments[0] !== 'messages' || !LEGACY_ACCOUNT_DIR.test(segments[1] ?? '')) continue
    document.media[mediaKey] = { ...entry, relativePath: ['messages', ...segments.slice(2)].join('/') }
    changed += 1
  }
  if (changed > 0) writeJsonDocument(getTelegramMediaIndexPath(), document)
  return changed
}

/** 正名整个 messages/ 目录（影库首次加载跑一次；含旧 acc 目录迁移，只改文件名/快照，不动媒体字节） */
export async function normalizeTelegramLibrary(): Promise<TelegramNormalizeSummary> {
  const summary: TelegramNormalizeSummary = { messages: 0, changed: 0, migrated: 0 }
  summary.migrated = (await migrateTelegramAccountLayout()).messages
  const messagesRoot = getTelegramMessagesRoot()
  const peers = await readdir(messagesRoot, { withFileTypes: true }).catch(() => [])

  for (const peer of peers) {
    if (!peer.isDirectory() || !peer.name.startsWith('peer-')) continue
    const peerId = peer.name.slice('peer-'.length)
    let messageNames: string[]
    try {
      messageNames = await readdir(path.join(messagesRoot, peer.name))
    } catch {
      continue
    }
    for (const messageName of messageNames) {
      const messageId = Number(messageName)
      if (!Number.isSafeInteger(messageId) || messageId <= 0) continue
      summary.messages += 1
      try {
        summary.changed += await normalizeTelegramMessageNames(peerId, messageId)
      } catch {
        // 单条失败不影响其它消息
      }
    }
  }
  return summary
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

/**
 * 分片写入时的元信息节流：一个 4MB 分片就重写一次 archive.meta.json + peer 索引，
 * 缓存大视频时会把磁盘 IO 打满（同时播放/滚动就会卡）。进度以实际文件大小为准，
 * 落盘频率降到 ~700ms 一次即可；complete 走 finalizeAttachment 立即落盘。
 */
const META_WRITE_INTERVAL_MS = 700
const metaWriteTimes = new Map<string, number>()

function shouldWriteMeta(dir: string, now = Date.now()): boolean {
  const last = metaWriteTimes.get(dir) ?? 0
  return now - last >= META_WRITE_INTERVAL_MS
}

async function writeMeta(dir: string, meta: MessageMetaDocument): Promise<void> {
  meta.updatedAt = Date.now()
  await writeJsonAtomic(metaPath(dir), meta)
  metaWriteTimes.set(dir, meta.updatedAt)
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

/** 旧版 `001.jpg` → `photo_<id>.jpg`：返回是否真的改过名（0 次即已是新布局） */
async function migrateLegacyAttachmentFile(
  dir: string,
  attachment: Pick<MessageMetaAttachment, 'index' | 'mediaKey' | 'mimeType' | 'fileName'>,
): Promise<boolean> {
  const target = attachmentFinalPath(dir, attachment)
  const legacy = legacyAttachmentFinalPath(dir, attachment)
  if (target === legacy) return false
  let migrated = false
  try {
    if (!existsSync(target) && existsSync(legacy)) {
      await rename(legacy, target)
      migrated = true
    }
    const targetPart = `${target}.part`
    const legacyPart = `${legacy}.part`
    if (!existsSync(targetPart) && existsSync(legacyPart)) await rename(legacyPart, targetPart)
  } catch {
    // 改名失败就按新名字重新落盘，不阻断 prepare
  }
  return migrated
}

/** 幂等：已完成直接返回 complete；进行中补齐/合并附件清单；否则新建 archive.meta.json */
export async function prepareTelegramMessage(
  request: TelegramArchivePrepareRequest,
): Promise<TelegramArchivePrepareResponse> {
  assertPeerId(request.peer.id)
  assertMessageId(request.messageId)
  await migrateTelegramAccountLayout().catch(() => undefined)
  const dir = telegramMessageDir(request.peer.id, request.messageId)

  const existingManifest = await readJsonFile<TelegramMessageManifest>(manifestPath(dir))
  if (existingManifest?.status === 'complete') {
    // 已完成的消息也可能还是旧布局（001.jpg / text.md）：顺手正名，失败不影响返回
    await normalizeTelegramMessageNames(request.peer.id, request.messageId).catch(() => 0)
    return {
      state: 'complete',
      thumbnailSaved: Boolean(existingManifest.thumbnail),
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
  meta.forwardSource = request.forwardSource ?? meta.forwardSource

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

    await migrateLegacyAttachmentFile(dir, attachment)
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
  // 进行中也要有内容快照：目录里「群/消息 id」旁边能直接读到正文与附件清单
  await writeContentSnapshot(dir, meta, request.text ?? '', Boolean(request.textTruncated))
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
    thumbnailSaved: Boolean(meta.thumbnail),
  }
}

/** 保存 / 覆盖消息缩略图；单独进 media-index，供影库通过 /media 展示 */
export async function saveTelegramThumbnail(input: {
  peerId: string
  messageId: number
  mediaKey: string
  mimeType: string
  data: Buffer
}): Promise<TelegramThumbnailSnapshot> {
  assertPeerId(input.peerId)
  assertMessageId(input.messageId)
  if (!/^[\w.-]{1,200}$/.test(input.mediaKey)) throw new Error('thumbnail mediaKey 非法')
  if (!/^image\/[\w.+-]+$/.test(input.mimeType)) throw new Error('thumbnail mime 非法')
  if (input.data.length === 0) throw new Error('thumbnail 是空的')
  if (input.data.length > 5 * 1024 * 1024) throw new Error('thumbnail 过大')

  const dir = telegramMessageDir(input.peerId, input.messageId)
  const extension = EXTENSION_BY_MIME[input.mimeType] ?? '.jpg'
  const finalPath = path.join(dir, MEDIA_DIR, `${input.mediaKey}${extension}`)
  await mkdir(path.dirname(finalPath), { recursive: true })
  const tempPath = `${finalPath}.tmp-${process.pid}`
  await writeFile(tempPath, input.data)
  await rename(tempPath, finalPath)

  const now = Date.now()
  const snapshot: TelegramThumbnailSnapshot = {
    mediaKey: input.mediaKey,
    mimeType: input.mimeType,
    size: input.data.length,
    relativePath: toTelegramRelativePath(finalPath),
    savedAt: now,
  }
  recordTelegramMedia({
    mediaKey: input.mediaKey,
    relativePath: snapshot.relativePath,
    size: snapshot.size,
    mimeType: input.mimeType,
  })

  const manifest = await readJsonFile<TelegramMessageManifest>(manifestPath(dir))
  const meta = await readMeta(dir)
  if (meta) {
    meta.thumbnail = snapshot
    meta.updatedAt = now
    await writeMeta(dir, meta)
  }
  if (manifest) {
    manifest.thumbnail = snapshot
    manifest.updatedAt = now
    await writeJsonAtomic(manifestPath(dir), manifest)
  }
  if (!meta && !manifest) throw new Error('消息尚未 prepare')
  return snapshot
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
}): Promise<{ received: number, expected: number, complete: boolean }> {
  assertPeerId(input.peerId)
  assertMessageId(input.messageId)
  const index = assertAttachmentIndex(input.index)
  if (!Number.isSafeInteger(input.offset) || input.offset < 0) throw new Error('offset 非法')

  const dir = telegramMessageDir(input.peerId, input.messageId)
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
  if (shouldWriteMeta(dir)) {
    await writeMeta(dir, meta)
    const { received: totalReceived } = progressOf(meta)
    updateMessageIndex(meta.peer.id, meta.messageId, {
      state: 'partial',
      attachments: meta.attachments.length,
      size: totalReceived,
      updatedAt: Date.now(),
    })
  }

  return { received, expected, complete: false }
}

/** 完成归档：所有附件 complete 才写 manifest.json / message.md（完成标记） */
export async function commitTelegramMessage(input: {
  peerId: string
  messageId: number
  text?: string
  textTruncated?: boolean
}): Promise<{ state: TelegramMessageState, manifest?: TelegramMessageManifest }> {
  assertPeerId(input.peerId)
  assertMessageId(input.messageId)
  const dir = telegramMessageDir(input.peerId, input.messageId)
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
  // 正文与元信息一起落盘：没有正文的消息也留下可读的 message.md
  await writeContentSnapshot(dir, meta, text, Boolean(input.textTruncated))
  await rm(path.join(dir, LEGACY_TEXT_FILE), { force: true }).catch(() => undefined)

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
    forwardSource: meta.forwardSource,
    thumbnail: meta.thumbnail,
    text: { saved: true, chars: text.length, truncated: Boolean(input.textTruncated), file: CONTENT_FILE },
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
