// 消息级缓存（v4）：messages/<群目录>/<消息 id 补零 15 位>/message.md + media/<mediaKey>.<ext>
//
// 设计要点：
// - 目录就是「群目录 / 消息 id / 消息内容」三级：`<username>-peer-<id>`，无 username 时 `peer-<id>`；
// - 群目录名由 peer-dirs.ts 登记（见 peer-dirs.json），消息 id 目录只由数值 id 生成；
// - 群名、发送者、正文写进 message.md 与 manifest 快照；
// - 附件路径相对消息目录（`media/<file>`）：群目录改名只需 rename + 重写 media-index；
// - 旧版 `messages/acc-<scope>/…` 那一级（多账号占位，从未接线）会在首次扫描时上移一级并删除；
// - 媒体文件名取 mediaKey（`photo_<id>` / `document_<id>`），一眼可辨归属；旧版 `001.jpg` 会在 prepare 时迁移；
// - `.part` 只接受连续前缀（offset 超过当前大小就丢弃），完成后 rename + SHA-256 + 对象库硬链；
// - manifest.json 是唯一的"完成标记"；archive.meta.json 只表示进行中；
// - 媒体索引（config/media-index.json）给 /media/<mediaKey> 与播放路径使用；
// - 任何远端错误都不在这里触发删除（R5）。
import type {
  ArchiveAttachmentState,
  ArchiveForwardSourceSnapshot,
  ArchiveMediaLinkMode,
  ArchiveMessageAttachment,
  ArchiveMessageManifest,
  ArchiveMessagePeerSnapshot,
  ArchiveMessageState,
  ArchiveMessageStatusEntry,
  ArchiveMessageStatusHint,
  ArchivePrepareRequest,
  ArchivePrepareResponse,
  ArchiveStatusVia,
  ArchiveThumbnailSnapshot,
} from '../../../../shared/media-archive.ts'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, linkSync, statSync } from 'node:fs'
import { copyFile, mkdir, open, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import {
  getArchiveConfigRoot,
  getArchiveMediaIndexPath,
  getArchiveMessageIndexRoot,
  getArchiveMessagesRoot,
  getArchiveObjectsDir,
  resolveArchiveRelativePath,
  toArchiveRelativePath,
  toMessageRelativePath,
} from './paths.ts'
import {
  findArchivePeerIdByDir,
  getArchivePeerDir,
  getArchivePeerEntry,
  isLegacyPeerDir,
  preferredPeerDir,
  setArchivePeerEntry,
} from './peer-dirs.ts'

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
  linkMode?: ArchiveMediaLinkMode
  status: ArchiveAttachmentState
  received?: number
}

interface MessageMetaDocument {
  schemaVersion: 1
  peer: ArchiveMessagePeerSnapshot
  messageId: number
  groupedId?: string
  date?: string
  editDate?: string
  sender?: { id?: string, name?: string }
  forwardSource?: ArchiveForwardSourceSnapshot
  thumbnail?: ArchiveThumbnailSnapshot
  createdAt: number
  updatedAt: number
  attachments: MessageMetaAttachment[]
}

interface MessageIndexEntry {
  state: ArchiveMessageState
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

export interface ArchiveMediaRecord {
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

export function buildArchiveMessageKey(peerId: string, messageId: number): string {
  return `tgmsg:v1:${peerId}:${messageId}`
}

export function archiveMessageDir(peerId: string, messageId: number): string {
  return path.join(
    getArchiveMessagesRoot(),
    getArchivePeerDir(assertPeerId(peerId)),
    padMessageId(assertMessageId(messageId)),
  )
}

// ---------------------------------------------------------------------------
// peer 目录命名（见 peer-dirs.ts）：`<username>-peer-<peerId>`，没有 username 时 `peer-<peerId>`。
// 目录名只是给人看的；真实身份是 peer id。username 变化会跟着改名，但只 rename 目录 +
// 重写 media-index；消息里的附件路径相对消息目录（`media/<file>`），不随 peer 目录变化。
// ---------------------------------------------------------------------------

const peerDirTasks = new Map<string, Promise<void>>()
/** 运行中的任务期间又扫到的同 peer 目录（normalize 用），下一次循环合并 */
const extraPeerDirs = new Map<string, Set<string>>()

function queueExtraPeerDir(peerId: string, dir?: string): void {
  if (!dir) return
  let set = extraPeerDirs.get(peerId)
  if (!set) {
    set = new Set()
    extraPeerDirs.set(peerId, set)
  }
  set.add(dir)
}

function drainExtraPeerDirs(peerId: string): string[] {
  const set = extraPeerDirs.get(peerId)
  if (!set?.size) return []
  const dirs = [...set]
  set.clear()
  return dirs
}

/**
 * 幂等：把 peer 目录收敛到规范名。
 * `scannedDir` 是 normalize 实际扫描到的目录名（可能是标题 slug / username-only / 手工改名）。
 * `freshUsername=false` 时，已登记且形状规范的目录保持不变（normalize 拿到的是旧快照，不能据此改名）。
 */
export function ensureArchivePeerDir(
  peer?: ArchiveMessagePeerSnapshot,
  scannedDir?: string,
  freshUsername = true,
): Promise<void> {
  const peerId = peer?.id
  if (!peer || typeof peerId !== 'string' || !/^-?\d{1,20}$/.test(peerId)) return Promise.resolve()
  queueExtraPeerDir(peerId, scannedDir)
  const running = peerDirTasks.get(peerId)
  if (running) return running
  const task = (async () => {
    await runEnsureArchivePeerDir(peerId, peer, freshUsername, drainExtraPeerDirs(peerId))
    // 运行期间 normalize 又送进来的目录：再收敛一轮（幂等，通常是空）
    for (let more = drainExtraPeerDirs(peerId); more.length > 0; more = drainExtraPeerDirs(peerId)) {
      await runEnsureArchivePeerDir(peerId, peer, freshUsername, more)
    }
  })().finally(() => {
    peerDirTasks.delete(peerId)
    extraPeerDirs.delete(peerId)
  })
  peerDirTasks.set(peerId, task)
  return task
}

function sameDirName(left: string, right: string): boolean {
  // Windows / macOS 大小写不敏感；只差大小写时不改名（NTFS 上也没法一步改）
  return left.toLowerCase() === right.toLowerCase()
}

/** 形状是否是规范名：`peer-<id>` 或 `<something>-peer-<id>` */
function isCanonicalPeerDir(dir: string, peerId: string): boolean {
  const suffix = `-peer-${peerId}`
  return dir === `peer-${peerId}` || (dir.length > suffix.length && dir.endsWith(suffix))
}

/** 目录是否属于该 peer：登记表优先，其次读目录内首条 manifest / meta；空目录视为可用 */
async function dirBelongsToPeer(dirName: string, peerId: string): Promise<boolean> {
  const owner = await resolveArchivePeerIdFromDir(dirName)
  return owner === undefined || owner === peerId
}

/** 把 sourceDir 的内容逐个搬进 targetDir，同名消息保留 targetDir 那份；返回真正搬走的条目名 */
async function mergePeerDirContents(sourceDir: string, targetDir: string): Promise<string[]> {
  const messagesRoot = getArchiveMessagesRoot()
  const source = path.join(messagesRoot, sourceDir)
  const target = path.join(messagesRoot, targetDir)
  const items = await readdir(source, { withFileTypes: true }).catch(() => [])
  const moved: string[] = []
  await mkdir(target, { recursive: true })
  for (const item of items) {
    const to = path.join(target, item.name)
    if (existsSync(to)) continue
    try {
      await rename(path.join(source, item.name), to)
      moved.push(item.name)
    } catch (error) {
      logger.warn('Failed to merge archive peer entry', {
        from: sourceDir,
        to: targetDir,
        name: item.name,
        error: (error as Error).message,
      })
    }
  }
  await rmdir(source).catch(() => undefined)
  return moved
}

async function runEnsureArchivePeerDir(
  peerId: string,
  peer: ArchiveMessagePeerSnapshot,
  freshUsername: boolean,
  scannedDirs: string[],
): Promise<void> {
  const messagesRoot = getArchiveMessagesRoot()
  const entry = getArchivePeerEntry(peerId)
  const legacyDir = `peer-${peerId}`
  const snapshot = { username: peer.username, title: peer.titleSnapshot }
  // normalize 拿到的是登记表 / manifest 里的旧快照：已登记且形状规范时不要据此改名
  const registeredDir = entry?.dir
  let targetDir = preferredPeerDir(peer)
  if (!freshUsername && registeredDir !== undefined && isCanonicalPeerDir(registeredDir, peerId)) {
    targetDir = registeredDir
  }

  // 只差大小写时保留磁盘上的现有写法：Windows 上改不了，Linux 上改了会找不到
  const caseVariant = [entry?.dir, legacyDir, ...scannedDirs]
    .find(dir => dir
      && dir !== targetDir
      && sameDirName(dir, targetDir)
      && existsSync(path.join(messagesRoot, dir)))
  if (caseVariant) targetDir = caseVariant

  // 极端情况：规范目录已存在但内容属于另一个 peer（手工复制 / 冲突）。不要合并，退回裸 peer-<id>
  if (!sameDirName(targetDir, legacyDir) && existsSync(path.join(messagesRoot, targetDir))) {
    if (!await dirBelongsToPeer(targetDir, peerId)) {
      logger.warn('Archive peer directory is owned by another peer', { peerId, dir: targetDir })
      targetDir = legacyDir
    }
  }

  const sources: string[] = []
  const seen = new Set<string>()
  for (const dir of [entry?.dir, legacyDir, ...scannedDirs]) {
    if (!dir || sameDirName(dir, targetDir)) continue
    const key = dir.toLowerCase()
    if (seen.has(key) || !existsSync(path.join(messagesRoot, dir))) continue
    seen.add(key)
    sources.push(dir)
  }

  // 目标不存在时，先把第一个来源整体 rename 过去（同卷 O(1)）
  if (!existsSync(path.join(messagesRoot, targetDir))) {
    const first = sources.shift()
    if (first) {
      try {
        await rename(path.join(messagesRoot, first), path.join(messagesRoot, targetDir))
        rewriteMediaIndexPeerDir(first, targetDir)
        logger.info('Archive peer directory renamed', { peerId, from: first, to: targetDir })
      } catch (error) {
        logger.warn('Failed to rename archive peer directory', {
          peerId,
          from: first,
          to: targetDir,
          error: (error as Error).message,
        })
        setArchivePeerEntry(peerId, { dir: first, ...snapshot })
        return
      }
    }
  }

  // 其余历史目录逐个合并（旧 peer-<id> / username-only / 标题 slug / 手工改名）
  for (const source of sources) {
    const moved = await mergePeerDirContents(source, targetDir)
    if (moved.length === 0) {
      // 只剩重复消息或被占用：保留原目录（不递归删），下次 normalize 再试
      if (existsSync(path.join(messagesRoot, source))) {
        logger.warn('Archive peer directory not fully merged', { peerId, from: source, to: targetDir })
      }
      continue
    }
    rewriteMediaIndexMovedMessages(source, targetDir, new Set(moved))
    logger.info('Archive peer directory merged', { peerId, from: source, to: targetDir, moved: moved.length })
  }

  // 登记目录已经不在了、但规范目录已存在（用户手工改名 / 上次改名中断）：把索引指向现有目录
  if (entry?.dir && !sameDirName(entry.dir, targetDir) && !existsSync(path.join(messagesRoot, entry.dir))) {
    rewriteMediaIndexPeerDir(entry.dir, targetDir)
  }

  setArchivePeerEntry(peerId, { dir: targetDir, ...snapshot })
}

/** peer 目录改名后，把 media-index 里 `messages/<旧目录>/…` 换成新目录 */
function rewriteMediaIndexPeerDir(fromDir: string, toDir: string): void {
  const document = readMediaIndex()
  const prefix = `messages/${fromDir}/`
  let changed = 0
  for (const [mediaKey, entry] of Object.entries(document.media)) {
    if (!entry?.relativePath?.startsWith(prefix)) continue
    document.media[mediaKey] = {
      ...entry,
      relativePath: `messages/${toDir}/${entry.relativePath.slice(prefix.length)}`,
    }
    changed += 1
  }
  if (changed > 0) writeJsonDocument(getArchiveMediaIndexPath(), document)
}

/** 合并目录时只重写真正搬走的那些消息（搬失败的条目仍指向原目录） */
function rewriteMediaIndexMovedMessages(fromDir: string, toDir: string, moved: Set<string>): void {
  const document = readMediaIndex()
  const prefix = `messages/${fromDir}/`
  let changed = 0
  for (const [mediaKey, entry] of Object.entries(document.media)) {
    const relativePath = entry?.relativePath
    if (!relativePath?.startsWith(prefix)) continue
    const rest = relativePath.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash <= 0 || !moved.has(rest.slice(0, slash))) continue
    document.media[mediaKey] = { ...entry, relativePath: `messages/${toDir}/${rest}` }
    changed += 1
  }
  if (changed > 0) writeJsonDocument(getArchiveMediaIndexPath(), document)
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

function describePeer(peer: ArchiveMessagePeerSnapshot): string {
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
  const document = readJsonDocument<MediaIndexDocument>(getArchiveMediaIndexPath(), () => ({
    schemaVersion: 1,
    media: {},
  }))
  return document && typeof document.media === 'object' && document.media !== null
    ? { schemaVersion: 1, media: document.media }
    : { schemaVersion: 1, media: {} }
}

export function recordArchiveMedia(input: {
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
  writeJsonDocument(getArchiveMediaIndexPath(), document)
}

export function resolveArchiveMediaRecord(mediaKey: string): ArchiveMediaRecord | undefined {
  if (!/^[\w.-]{1,200}$/.test(mediaKey)) return undefined
  const entry = readMediaIndex().media[mediaKey]
  if (!entry) return undefined
  const absolutePath = resolveArchiveRelativePath(entry.relativePath)
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

export function removeArchiveMedia(mediaKey: string): void {
  if (!/^[\w.-]{1,200}$/.test(mediaKey)) return
  const document = readMediaIndex()
  if (!document.media[mediaKey]) return
  delete document.media[mediaKey]
  writeJsonDocument(getArchiveMediaIndexPath(), document)
}

// ---------------------------------------------------------------------------
// 等价缓存：原消息 / 转发副本 / 同媒体副本共用一份「已缓存」判定。
//
// - sources：精确转发链接。转发的是频道帖 / 收藏消息时协议里带源 peer + 源消息 id，
//   双向可查（缓存源 → 转发命中；缓存转发 → 源命中）。
// - signatures：内容签名 = 排序后的媒体 key + 正文字符数。转发不会改 photo/document id，
//   所以用户之间的转发（协议不给源消息 id）也能靠它命中；只登记带媒体的消息，
//   纯文本消息仅靠精确链接，避免把长度相同的无关消息误判为同一内容。
// 索引落在配置层，随 messages/trash 的增删一起维护，normalize 时整体重建。
// ---------------------------------------------------------------------------

interface ArchiveAliasDocument {
  schemaVersion: 1
  sources: Record<string, string[]>
  signatures: Record<string, string[]>
}

export interface ArchiveAliasEntry {
  peerId: string
  messageId: number
  forwardSource?: ArchiveForwardSourceSnapshot
  mediaKeys?: string[]
  textChars?: number
}

export interface ArchiveEquivalentMatch {
  via: Exclude<ArchiveStatusVia, 'direct'>
  resolved: { peerId: string, messageId: number }
}

const MEDIA_KEY_PATTERN = /^[\w.-]{1,200}$/
const PEER_ID_PATTERN = /^-?\d{1,20}$/

function archiveAliasPath(): string {
  return path.join(getArchiveConfigRoot(), 'archive-alias.json')
}

function aliasKey(peerId: string, messageId: number): string {
  return `${peerId}:${messageId}`
}

function parseAliasKey(key: string): { peerId: string, messageId: number } | undefined {
  const match = /^(-?\d{1,20}):(\d{1,16})$/.exec(key)
  if (!match) return undefined
  const messageId = Number(match[2])
  if (!Number.isSafeInteger(messageId) || messageId <= 0) return undefined
  return { peerId: match[1], messageId }
}

/** 转发源快照 → 源消息 key；缺 peer id 或消息 id（用户转发 / 隐藏来源）时返回 undefined */
export function forwardSourceKey(source?: ArchiveForwardSourceSnapshot): string | undefined {
  const peerId = source?.id
  const messageId = source?.messageId
  if (typeof peerId !== 'string' || !PEER_ID_PATTERN.test(peerId)) return undefined
  if (typeof messageId !== 'number' || !Number.isSafeInteger(messageId) || messageId <= 0) return undefined
  return aliasKey(peerId, messageId)
}

function sanitizeAliasMap(input: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  if (typeof input !== 'object' || input === null) return result
  for (const [bucket, values] of Object.entries(input as Record<string, unknown>)) {
    if (!Array.isArray(values)) continue
    const keys = values.filter((value): value is string => typeof value === 'string' && Boolean(parseAliasKey(value)))
    if (keys.length) result[bucket] = [...new Set(keys)].sort()
  }
  return result
}

function readAliasDocument(): ArchiveAliasDocument {
  const document = readJsonDocument<Partial<ArchiveAliasDocument>>(archiveAliasPath(), () => ({
    schemaVersion: 1,
    sources: {},
    signatures: {},
  }))
  return {
    schemaVersion: 1,
    sources: sanitizeAliasMap(document?.sources),
    signatures: sanitizeAliasMap(document?.signatures),
  }
}

function writeAliasDocument(document: ArchiveAliasDocument): void {
  writeJsonDocument(archiveAliasPath(), document)
}

function pushAlias(map: Record<string, string[]>, bucket: string, key: string): void {
  if (bucket === key) return
  const values = map[bucket] ?? []
  if (values.includes(key)) return
  map[bucket] = [...values, key].sort()
}

/** 把某个消息 key 从所有桶里摘掉（删除 / 改判重写） */
function dropAliasKey(map: Record<string, string[]>, key: string): void {
  for (const [bucket, values] of Object.entries(map)) {
    if (!values.includes(key)) continue
    const next = values.filter(value => value !== key)
    if (next.length) map[bucket] = next
    else delete map[bucket]
  }
}

function contentSignature(mediaKeys?: string[], textChars?: number): string | undefined {
  if (!mediaKeys?.length) return undefined
  const keys = [...new Set(mediaKeys.filter(key => MEDIA_KEY_PATTERN.test(key)))].sort()
  if (!keys.length) return undefined
  const chars = typeof textChars === 'number' && Number.isSafeInteger(textChars) && textChars > 0 ? textChars : 0
  return `${keys.join('+')}#${chars}`
}

function applyAliasEntry(document: ArchiveAliasDocument, entry: ArchiveAliasEntry): void {
  if (!PEER_ID_PATTERN.test(entry.peerId)) return
  if (!Number.isSafeInteger(entry.messageId) || entry.messageId <= 0) return
  const self = aliasKey(entry.peerId, entry.messageId)
  const sourceKey = forwardSourceKey(entry.forwardSource)
  if (sourceKey) pushAlias(document.sources, sourceKey, self)
  const signature = contentSignature(entry.mediaKeys, entry.textChars)
  if (signature) pushAlias(document.signatures, signature, self)
}

/** 归档完成：登记精确转发链接与内容签名（幂等，重复提交只更新自己那一份） */
export function registerArchiveAliases(entry: ArchiveAliasEntry): void {
  assertPeerId(entry.peerId)
  assertMessageId(entry.messageId)
  const document = readAliasDocument()
  const self = aliasKey(entry.peerId, entry.messageId)
  dropAliasKey(document.sources, self)
  dropAliasKey(document.signatures, self)
  applyAliasEntry(document, entry)
  writeAliasDocument(document)
}

/** 删除 / 移入回收站：撤销该消息的所有等价关系 */
export function unregisterArchiveAliases(peerId: string, messageId: number): void {
  assertPeerId(peerId)
  assertMessageId(messageId)
  const document = readAliasDocument()
  const self = aliasKey(peerId, messageId)
  dropAliasKey(document.sources, self)
  dropAliasKey(document.signatures, self)
  writeAliasDocument(document)
}

/** 全量重建（normalize 时用；以扫描到的完整 manifest 为准） */
export function replaceArchiveAliases(entries: ArchiveAliasEntry[]): void {
  const document: ArchiveAliasDocument = { schemaVersion: 1, sources: {}, signatures: {} }
  for (const entry of entries) applyAliasEntry(document, entry)
  writeAliasDocument(document)
}

async function readCompleteManifest(
  peerId: string,
  messageId: number,
  requiredMediaKeys?: string[],
): Promise<ArchiveMessageManifest | undefined> {
  const dir = archiveMessageDir(peerId, messageId)
  const manifest = await readJsonFile<ArchiveMessageManifest>(manifestPath(dir))
  if (manifest?.status !== 'complete') return undefined
  if (requiredMediaKeys?.length) {
    const owned = new Set(manifest.attachments.map(attachment => attachment.mediaKey))
    if (!requiredMediaKeys.every(key => owned.has(key))) return undefined
  }
  return manifest
}

/**
 * 本条消息没有直接缓存时，找一条内容等价的已缓存消息。
 * 顺序：转发源 → 同内容签名 → 本条作为源消息的转发副本。
 */
export async function resolveArchiveEquivalent(
  peerId: string,
  messageId: number,
  hint?: ArchiveMessageStatusHint,
  aliasDocument?: ArchiveAliasDocument,
): Promise<ArchiveEquivalentMatch | undefined> {
  const document = aliasDocument ?? readAliasDocument()
  const self = aliasKey(peerId, messageId)
  const hintSource = forwardSourceKey(hint?.forwardSource)
  const requiredMediaKeys = hint?.mediaKeys

  // 1. 本条是转发、源消息已缓存
  if (hintSource && hintSource !== self) {
    const source = parseAliasKey(hintSource)
    if (source && await readCompleteManifest(source.peerId, source.messageId, requiredMediaKeys)) {
      return { via: 'source', resolved: source }
    }
  }

  // 2. 同媒体 + 同正文长度（转发不改变 photo/document id）
  const signature = contentSignature(hint?.mediaKeys, hint?.textChars)
  if (signature) {
    for (const candidate of document.signatures[signature] ?? []) {
      if (candidate === self) continue
      const parsed = parseAliasKey(candidate)
      if (!parsed) continue
      const manifest = await readCompleteManifest(parsed.peerId, parsed.messageId, requiredMediaKeys)
      if (!manifest) continue
      const via: ArchiveEquivalentMatch['via'] = hintSource && candidate === hintSource
        ? 'source'
        : (manifest.forwardSource ? 'forward' : 'media')
      return { via, resolved: parsed }
    }
  }

  // 3. 本条作为源消息、某份转发副本已缓存（纯文本的频道 / 收藏转发也能命中）
  for (const candidate of document.sources[self] ?? []) {
    const parsed = parseAliasKey(candidate)
    if (!parsed) continue
    if (await readCompleteManifest(parsed.peerId, parsed.messageId, requiredMediaKeys)) {
      return { via: 'forward', resolved: parsed }
    }
  }

  return undefined
}

/** 某条消息的等价 counterpart 列表（提交 / 删除后推 SSE 给正在看另一份副本的页面） */
export async function listArchiveEquivalents(
  peerId: string,
  messageId: number,
): Promise<Array<{ peerId: string, messageId: number, via: Exclude<ArchiveStatusVia, 'direct'> }>> {
  const manifest = await readArchiveMessageManifest(peerId, messageId)
  const document = readAliasDocument()
  const self = aliasKey(peerId, messageId)
  const result = new Map<string, { peerId: string, messageId: number, via: Exclude<ArchiveStatusVia, 'direct'> }>()

  const add = (key: string, via: Exclude<ArchiveStatusVia, 'direct'>): void => {
    if (key === self || result.has(key)) return
    const parsed = parseAliasKey(key)
    if (parsed) result.set(key, { ...parsed, via })
  }

  const sourceKey = forwardSourceKey(manifest?.forwardSource)
  if (sourceKey) add(sourceKey, 'forward')
  for (const candidate of document.sources[self] ?? []) add(candidate, 'source')

  const signature = contentSignature(
    manifest?.attachments.map(attachment => attachment.mediaKey),
    manifest?.text?.chars,
  )
  if (signature) {
    for (const candidate of document.signatures[signature] ?? []) {
      if (candidate === self) continue
      const parsed = parseAliasKey(candidate)
      if (!parsed) continue
      const other = await readArchiveMessageManifest(parsed.peerId, parsed.messageId)
      const otherSource = forwardSourceKey(other?.forwardSource)
      add(candidate, otherSource === self ? 'forward' : (otherSource && otherSource === sourceKey ? 'source' : 'media'))
    }
  }

  return [...result.values()]
}

function indexDocumentFor(peerId: string): { filePath: string, document: MessageIndexDocument } {
  const filePath = path.join(getArchiveMessageIndexRoot(), `peer-${assertPeerId(peerId)}.json`)
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

export function removeArchiveMessageIndexEntry(peerId: string, messageId: number): void {
  const { filePath, document } = indexDocumentFor(peerId)
  if (!document.messages[String(messageId)]) return
  delete document.messages[String(messageId)]
  writeJsonDocument(filePath, document)
}

export async function readArchiveMessageManifest(
  peerId: string,
  messageId: number,
): Promise<ArchiveMessageManifest | undefined> {
  const dir = archiveMessageDir(peerId, messageId)
  return readJsonFile<ArchiveMessageManifest>(manifestPath(dir))
}

export interface ArchiveMessageMediaItem {
  mediaKey: string
  mimeType?: string
  fileName?: string
  size: number
  relativePath: string
}

/** manifest（已完成）→ meta 形状，供重建 message.md 时复用同一套抬头 */
function manifestAsMeta(manifest: ArchiveMessageManifest): MessageMetaDocument {
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
export async function normalizeArchiveMessageNames(
  peerId: string,
  messageId: number,
  onManifest?: (manifest: ArchiveMessageManifest) => void,
): Promise<number> {
  const dir = archiveMessageDir(peerId, messageId)
  let changed = 0

  const manifest = await readJsonFile<ArchiveMessageManifest>(manifestPath(dir))
  if (manifest && Array.isArray(manifest.attachments)) {
    onManifest?.(manifest)
    for (const attachment of manifest.attachments) {
      const renamed = await migrateLegacyAttachmentFile(dir, attachment)
      const finalPath = attachmentFinalPath(dir, attachment)
      if (!existsSync(finalPath)) continue
      // 顺带把旧的完整相对路径（`messages/<peerDir>/<mid>/…`）改成消息内相对路径
      const expectedPath = toMessageRelativePath(dir, finalPath)
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
    const expectedPath = toMessageRelativePath(dir, finalPath)
    if (!renamed && attachment.relativePath === expectedPath) continue
    attachment.relativePath = expectedPath
    changed += 1
  }
  changed += await ensureContentFile(dir, () => meta)
  if (changed > 0) await writeMeta(dir, meta)
  return changed
}

export interface ArchiveNormalizeSummary {
  messages: number
  changed: number
  /** 从旧 `acc-<scope>/` 目录上移过来的消息数 */
  migrated: number
}

export interface ArchiveAccountMigrationSummary {
  messages: number
  media: number
}

let accountMigration: Promise<ArchiveAccountMigrationSummary> | undefined

/** 旧布局迁移（每次进程只跑一次，幂等）：`messages/acc-<scope>/peer-<id>/<mid>/` 上移一级 */
export function migrateArchiveAccountLayout(): Promise<ArchiveAccountMigrationSummary> {
  accountMigration ??= runAccountMigration().catch((error: unknown) => {
    accountMigration = undefined
    throw error
  })
  return accountMigration
}

async function runAccountMigration(): Promise<ArchiveAccountMigrationSummary> {
  const summary: ArchiveAccountMigrationSummary = { messages: 0, media: 0 }
  const messagesRoot = getArchiveMessagesRoot()
  /** 旧 `peer-<id>` 目录名 → 上移后的目录名（已登记的 peer 会直接落到 username / 标题目录） */
  const peerDirMoves = new Map<string, string>()
  const scopes = await readdir(messagesRoot, { withFileTypes: true }).catch(() => [])
  for (const scope of scopes) {
    if (!scope.isDirectory() || !LEGACY_ACCOUNT_DIR.test(scope.name)) continue
    const scopeRoot = path.join(messagesRoot, scope.name)
    summary.messages += await moveScopeMessagesUp(scopeRoot, peerDirMoves)
    // 只删空壳：万一有目录改名失败，留在原地的数据不能被递归删掉（下次再试）
    await rmdir(scopeRoot).catch(() => undefined)
  }

  const indexRoot = getArchiveMessageIndexRoot()
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

  summary.media = rewriteLegacyMediaPaths(peerDirMoves)
  for (const [fromDir, toDir] of peerDirMoves) {
    if (fromDir === toDir) continue
    rewriteMediaIndexPeerDir(fromDir, toDir)
  }
  return summary
}

/** 把一个 `acc-<scope>/` 里的 peer 目录（或其中的消息目录）搬到 messages/ 根下 */
async function moveScopeMessagesUp(scopeRoot: string, peerDirMoves: Map<string, string>): Promise<number> {
  let moved = 0
  const peers = await readdir(scopeRoot, { withFileTypes: true }).catch(() => [])
  for (const peer of peers) {
    if (!peer.isDirectory() || !isLegacyPeerDir(peer.name)) continue
    const peerId = peer.name.slice('peer-'.length)
    // 已经登记过可读目录名的 peer 直接上移到那个目录，避免旧的 peer-<id> 与可读目录并存
    const targetName = getArchivePeerDir(peerId)
    peerDirMoves.set(peer.name, targetName)
    const source = path.join(scopeRoot, peer.name)
    const targetPeer = path.join(getArchiveMessagesRoot(), targetName)
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
    await rmdir(source).catch(() => undefined)
  }
  return moved
}

/** media-index 里残留的 `messages/acc-<scope>/…` 相对路径去掉那一级 */
function rewriteLegacyMediaPaths(peerDirMoves: Map<string, string>): number {
  const document = readMediaIndex()
  let changed = 0
  for (const [mediaKey, entry] of Object.entries(document.media)) {
    const relativePath = entry?.relativePath ?? ''
    const segments = relativePath.split('/')
    if (segments[0] !== 'messages' || !LEGACY_ACCOUNT_DIR.test(segments[1] ?? '')) continue
    const targetDir = peerDirMoves.get(segments[2] ?? '')
    const nextSegments = targetDir
      ? ['messages', targetDir, ...segments.slice(3)]
      : ['messages', ...segments.slice(2)]
    document.media[mediaKey] = { ...entry, relativePath: nextSegments.join('/') }
    changed += 1
  }
  if (changed > 0) writeJsonDocument(getArchiveMediaIndexPath(), document)
  return changed
}

/** 目录名 → peer id：先查登记表，再认旧 `peer-<id>`，最后从首条 manifest 快照反查 */
export async function resolveArchivePeerIdFromDir(dirName: string): Promise<string | undefined> {
  const mapped = findArchivePeerIdByDir(dirName)
  if (mapped) return mapped
  if (isLegacyPeerDir(dirName)) return dirName.slice('peer-'.length)

  const peerDir = path.join(getArchiveMessagesRoot(), dirName)
  const names = await readdir(peerDir).catch(() => [])
  for (const name of names) {
    const messageId = Number(name)
    if (!Number.isSafeInteger(messageId) || messageId <= 0) continue
    const dir = path.join(peerDir, name)
    const manifest = await readJsonFile<ArchiveMessageManifest>(manifestPath(dir))
    const meta = manifest ?? await readMeta(dir)
    const id = meta?.peer?.id
    if (typeof id === 'string' && /^-?\d{1,20}$/.test(id)) return id
  }
  return undefined
}

async function probeArchivePeerSnapshot(
  dirName: string,
  peerId: string,
): Promise<ArchiveMessagePeerSnapshot> {
  const entry = getArchivePeerEntry(peerId)
  if (entry) return { id: peerId, username: entry.username, titleSnapshot: entry.title }

  const peerDir = path.join(getArchiveMessagesRoot(), dirName)
  const names = await readdir(peerDir).catch(() => [])
  for (const name of names) {
    const messageId = Number(name)
    if (!Number.isSafeInteger(messageId) || messageId <= 0) continue
    const dir = path.join(peerDir, name)
    const manifest = await readJsonFile<ArchiveMessageManifest>(manifestPath(dir))
    const meta = manifest ?? await readMeta(dir)
    if (meta?.peer) return { ...meta.peer, id: peerId }
  }
  return { id: peerId }
}

/** 正名整个 messages/ 目录（影库首次加载跑一次；含旧 acc 目录迁移，只改文件名/快照，不动媒体字节） */
export async function normalizeArchiveLibrary(): Promise<ArchiveNormalizeSummary> {
  const summary: ArchiveNormalizeSummary = { messages: 0, changed: 0, migrated: 0 }
  const aliasEntries: ArchiveAliasEntry[] = []
  summary.migrated = (await migrateArchiveAccountLayout()).messages
  const messagesRoot = getArchiveMessagesRoot()
  const peers = await readdir(messagesRoot, { withFileTypes: true }).catch(() => [])

  // 先收敛所有 peer 目录，再做消息级正名：旧 `peer-<id>` / username-only / 标题 slug 与规范目录
  // 并存时会在这一步合并，后面的消息扫描按 peerId 去重，避免同一批消息被数两次。
  const peerIds = new Set<string>()
  for (const peer of peers) {
    if (!peer.isDirectory()) continue
    const peerId = await resolveArchivePeerIdFromDir(peer.name)
    if (!peerId) continue
    const snapshot = await probeArchivePeerSnapshot(peer.name, peerId)
    // 把实际扫到的目录作为来源交给 ensure：登记表缺失 / 旧命名都能并到规范目录；
    // 快照来自旧记录，不允许据此改 username（freshUsername=false）
    await ensureArchivePeerDir(snapshot, peer.name, false).catch((error: unknown) => {
      logger.warn('Failed to normalize archive peer directory', {
        peerId,
        dir: peer.name,
        error: (error as Error).message,
      })
    })
    // 目录名变了（或旧目录被并入可读目录）也算改动：让前端重扫列表，避免展示已失效的相对路径
    if (getArchivePeerDir(peerId) !== peer.name) summary.changed += 1
    peerIds.add(peerId)
  }

  for (const peerId of peerIds) {
    let messageNames: string[]
    try {
      messageNames = await readdir(path.join(messagesRoot, getArchivePeerDir(peerId)))
    } catch {
      continue
    }
    for (const messageName of messageNames) {
      const messageId = Number(messageName)
      if (!Number.isSafeInteger(messageId) || messageId <= 0) continue
      summary.messages += 1
      try {
        summary.changed += await normalizeArchiveMessageNames(peerId, messageId, (manifest) => {
          aliasEntries.push({
            peerId,
            messageId,
            forwardSource: manifest.forwardSource,
            mediaKeys: manifest.attachments.map(attachment => attachment.mediaKey),
            textChars: manifest.text?.chars ?? 0,
          })
        })
      } catch {
        // 单条失败不影响其它消息
      }
    }
  }
  // 旧版本归档没有别名索引：借这次全量扫描一次建好，之后完全增量维护
  replaceArchiveAliases(aliasEntries)
  return summary
}

/** 一条消息可播放/可打开的媒体清单（影库内置播放用） */
export async function listArchiveMessageMedia(peerId: string, messageId: number): Promise<ArchiveMessageMediaItem[]> {
  const manifest = await readArchiveMessageManifest(peerId, messageId)
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

function toAttachment(metaAttachment: MessageMetaAttachment): ArchiveMessageAttachment {
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
export async function prepareArchiveMessage(
  request: ArchivePrepareRequest,
): Promise<ArchivePrepareResponse> {
  assertPeerId(request.peer.id)
  assertMessageId(request.messageId)
  await migrateArchiveAccountLayout().catch(() => undefined)
  // 首次见到该 peer 时登记 username / 标题目录；旧 peer-<id> 目录在这里迁移
  await ensureArchivePeerDir(request.peer)
  const dir = archiveMessageDir(request.peer.id, request.messageId)

  const existingManifest = await readJsonFile<ArchiveMessageManifest>(manifestPath(dir))
  if (existingManifest?.status === 'complete') {
    // 已完成的消息也可能还是旧布局（001.jpg / text.md）：顺手正名，失败不影响返回
    await normalizeArchiveMessageNames(request.peer.id, request.messageId).catch(() => 0)
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
      attachment.relativePath = toMessageRelativePath(dir, finalPath)
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
export async function saveArchiveThumbnail(input: {
  peerId: string
  messageId: number
  mediaKey: string
  mimeType: string
  data: Buffer
}): Promise<ArchiveThumbnailSnapshot> {
  assertPeerId(input.peerId)
  assertMessageId(input.messageId)
  if (!/^[\w.-]{1,200}$/.test(input.mediaKey)) throw new Error('thumbnail mediaKey 非法')
  if (!/^image\/[\w.+-]+$/.test(input.mimeType)) throw new Error('thumbnail mime 非法')
  if (input.data.length === 0) throw new Error('thumbnail 是空的')
  if (input.data.length > 5 * 1024 * 1024) throw new Error('thumbnail 过大')

  const dir = archiveMessageDir(input.peerId, input.messageId)
  const extension = EXTENSION_BY_MIME[input.mimeType] ?? '.jpg'
  const finalPath = path.join(dir, MEDIA_DIR, `${input.mediaKey}${extension}`)
  await mkdir(path.dirname(finalPath), { recursive: true })
  const tempPath = `${finalPath}.tmp-${process.pid}`
  await writeFile(tempPath, input.data)
  await rename(tempPath, finalPath)

  const now = Date.now()
  const snapshot: ArchiveThumbnailSnapshot = {
    mediaKey: input.mediaKey,
    mimeType: input.mimeType,
    size: input.data.length,
    relativePath: toMessageRelativePath(dir, finalPath),
    savedAt: now,
  }
  recordArchiveMedia({
    mediaKey: input.mediaKey,
    relativePath: toArchiveRelativePath(finalPath),
    size: snapshot.size,
    mimeType: input.mimeType,
  })

  const manifest = await readJsonFile<ArchiveMessageManifest>(manifestPath(dir))
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

async function linkObjectIntoMessage(finalPath: string, sha256: string): Promise<ArchiveMediaLinkMode> {
  const objectPath = path.join(getArchiveObjectsDir(), sha256.slice(0, 2), sha256)
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
  attachment.relativePath = toMessageRelativePath(dir, finalPath)
  attachment.linkMode = linkMode
  attachment.received = size

  recordArchiveMedia({
    mediaKey: attachment.mediaKey,
    relativePath: toArchiveRelativePath(finalPath),
    size,
    mimeType: attachment.mimeType,
    sha256,
  })
  await writeMeta(dir, meta)
}

/** 追加分片；offset 超过当前大小视为跳写（丢弃），保持连续前缀 */
export async function appendArchiveAttachment(input: {
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

  const dir = archiveMessageDir(input.peerId, input.messageId)
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
export async function commitArchiveMessage(input: {
  peerId: string
  messageId: number
  text?: string
  textTruncated?: boolean
}): Promise<{ state: ArchiveMessageState, manifest?: ArchiveMessageManifest }> {
  assertPeerId(input.peerId)
  assertMessageId(input.messageId)
  const dir = archiveMessageDir(input.peerId, input.messageId)
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
  const manifest: ArchiveMessageManifest = {
    schemaVersion: 1,
    messageKey: buildArchiveMessageKey(meta.peer.id, meta.messageId),
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
  registerArchiveAliases({
    peerId: meta.peer.id,
    messageId: meta.messageId,
    forwardSource: manifest.forwardSource,
    mediaKeys: manifest.attachments.map(attachment => attachment.mediaKey),
    textChars: text.length,
  })
  return { state: 'complete', manifest }
}

export async function getArchiveMessageStatuses(
  peerId: string,
  messageIds: number[],
  hints?: ArchiveMessageStatusHint[],
): Promise<Record<string, ArchiveMessageStatusEntry>> {
  const statuses: Record<string, ArchiveMessageStatusEntry> = {}
  const hintById = new Map((hints ?? []).map(hint => [hint.messageId, hint]))
  // 一次批量查询只解析一份索引：逐条 readAliasDocument 会把整个索引复制 N 次
  const aliasDocument = readAliasDocument()
  for (const messageId of messageIds) {
    const key = String(messageId)
    try {
      const dir = archiveMessageDir(peerId, messageId)
      const manifest = await readJsonFile<ArchiveMessageManifest>(manifestPath(dir))
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
      const equivalent = await resolveArchiveEquivalent(peerId, messageId, hintById.get(messageId), aliasDocument)
      if (equivalent) {
        statuses[key] = {
          state: 'complete',
          via: equivalent.via,
          resolved: equivalent.resolved,
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
export function getArchiveMediaStatuses(keys: string[]): Record<string, ArchiveMessageStatusEntry> {
  const statuses: Record<string, ArchiveMessageStatusEntry> = {}
  for (const key of keys) {
    const record = resolveArchiveMediaRecord(key)
    statuses[key] = record
      ? { state: 'complete', received: record.size, expected: record.size, progress: 1 }
      : { state: 'missing' }
  }
  return statuses
}
