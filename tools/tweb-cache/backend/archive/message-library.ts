// 本地影库（v4）：扫描 messages/<群目录>/<消息 id>/（`<username>-peer-<id>`，无 username 时 `peer-<id>`），
// 给工具侧 library 面板提供只读列表。
// 不访问网络、不调用 MTProto；manifest 缺失时按 archive.meta.json 标为 partial。
import type { ArchiveForwardSourceSnapshot, ArchiveLibraryEntry, ArchiveMessageState } from '../../../../shared/media-archive.ts'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { logger } from '../../../../backend/utils/logger.ts'
import {
  archiveMessageDirName,
  listArchiveMessageIndex,
  migrateArchiveAccountLayout,
  resolveArchivePeerIdFromDir,
} from './message-store.ts'
import { getArchiveMessagesRoot, toArchiveRelativePath } from './paths.ts'

const MAX_ENTRIES = 500
const TEXT_PREVIEW_CHARS = 160
const CONTENT_FILES = ['message.md', 'text.md']

interface ManifestLike {
  peer?: { id?: string, titleSnapshot?: string, username?: string }
  messageId?: number
  groupedId?: string
  savedAt?: number
  status?: ArchiveMessageState
  senderSnapshot?: { name?: string }
  forwardSource?: ArchiveForwardSourceSnapshot
  thumbnail?: { mediaKey: string }
  text?: { file?: string }
  attachments?: Array<{ kind?: string, actualSize?: number, expectedSize?: number, mediaKey?: string }>
}

interface MetaLike {
  peer?: { id?: string, titleSnapshot?: string, username?: string }
  messageId?: number
  groupedId?: string
  updatedAt?: number
  sender?: { name?: string }
  forwardSource?: ArchiveForwardSourceSnapshot
  thumbnail?: { mediaKey: string }
  attachments?: Array<{ kind?: string, actualSize?: number, received?: number, expectedSize?: number, mediaKey?: string }>
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch {
    return undefined
  }
}

/** 取 message.md 的正文段落：跳过标题与 `- 键：值` 头部行 */
function extractBody(raw: string): string {
  return raw
    .split(/\r?\n/)
    .filter(line => !line.startsWith('# ') && !line.startsWith('- ') && !line.startsWith('> '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function readContentPreview(dir: string, declaredFile?: string): Promise<string | undefined> {
  const candidates = new Set([declaredFile, ...CONTENT_FILES].filter(Boolean) as string[])
  for (const name of candidates) {
    try {
      const body = extractBody(await readFile(path.join(dir, name), 'utf8'))
      return body ? body.slice(0, TEXT_PREVIEW_CHARS) : undefined
    } catch {
      continue
    }
  }
  return undefined
}

/** 会话/消息 id → 可在 Archive 里定位该消息的链接 */
function buildMessageLink(peerId: string, messageId: number, username?: string): string {
  if (username) return `https://t.me/${username}/${messageId}`
  if (peerId.startsWith('-100')) return `https://t.me/c/${peerId.slice(4)}/${messageId}`
  if (peerId.startsWith('-')) return `tg://openmessage?chat_id=${peerId}&message_id=${messageId}`
  return `tg://openmessage?user_id=${peerId}&message_id=${messageId}`
}

interface LibraryCandidate {
  peerId: string
  peerDir: string
  messageId: number
  sortAt: number
  manifest?: ManifestLike
  meta?: MetaLike
}

export async function listArchiveLibrary(): Promise<ArchiveLibraryEntry[]> {
  const startedAt = Date.now()
  const root = getArchiveMessagesRoot()
  // 目录迁移期间可能同时存在旧目录与规范目录：同一 (peer, message) 只展示一次
  const seenMessages = new Set<string>()

  // 旧版 messages/acc-<scope>/ 那一级在这里顺手上移（幂等，每个进程只跑一次）
  await migrateArchiveAccountLayout().catch(() => undefined)
  const peers = await readdir(root, { withFileTypes: true }).catch(() => [])
  const candidates: LibraryCandidate[] = []
  for (const peer of peers) {
    if (!peer.isDirectory()) continue
    // 群目录名可能是 `<username>-peer-<id>`，也可能是迁移中的旧命名：统一反查真实 peer id
    const resolvedPeerId = await resolveArchivePeerIdFromDir(peer.name)
    if (!resolvedPeerId) continue
    const peerDir = path.join(root, peer.name)

    // 正常路径：从消息索引拿「全部消息 + 时间」，先全局排序再只读前 MAX_ENTRIES 个 manifest
    const indexed = listArchiveMessageIndex(resolvedPeerId)
    if (indexed.length) {
      for (const item of indexed) {
        candidates.push({
          peerId: resolvedPeerId,
          peerDir,
          messageId: item.messageId,
          sortAt: item.savedAt ?? item.updatedAt,
        })
      }
      continue
    }

    // 索引缺失（旧归档 / 索引损坏）：退回目录扫描，顺序由 manifest 时间决定
    const messages = await readdir(peerDir, { withFileTypes: true }).catch(() => [])
    for (const message of messages) {
      if (!message.isDirectory()) continue
      const messageId = Number(message.name)
      if (!Number.isSafeInteger(messageId) || messageId <= 0) continue
      const messageDir = path.join(peerDir, message.name)
      const manifest = await readJson<ManifestLike>(path.join(messageDir, 'manifest.json'))
      const meta = manifest ? undefined : await readJson<MetaLike>(path.join(messageDir, 'archive.meta.json'))
      if (!manifest && !meta) continue
      candidates.push({
        peerId: resolvedPeerId,
        peerDir,
        messageId,
        sortAt: manifest?.savedAt ?? meta?.updatedAt ?? 0,
        manifest,
        meta,
      })
    }
  }

  // 先排序再截断，避免新消息被上限截掉
  candidates.sort((left, right) => right.sortAt - left.sortAt)

  const entries: ArchiveLibraryEntry[] = []
  for (const candidate of candidates) {
    if (entries.length >= MAX_ENTRIES) break
    const messageDir = path.join(candidate.peerDir, archiveMessageDirName(candidate.messageId))
    let manifest = candidate.manifest
    let meta = candidate.meta
    if (!manifest && !meta) {
      manifest = await readJson<ManifestLike>(path.join(messageDir, 'manifest.json'))
      meta = manifest ? undefined : await readJson<MetaLike>(path.join(messageDir, 'archive.meta.json'))
    }
    const source = manifest ?? meta
    if (!source) continue

    const attachments = source.attachments ?? []
    const received = attachments.reduce((total, item) => (
      total + (item.actualSize ?? (item as { received?: number }).received ?? 0)
    ), 0)
    const expected = attachments.reduce((total, item) => total + (item.expectedSize ?? 0), 0)
    const messageId = source.messageId ?? candidate.messageId
    const peerId = source.peer?.id ?? candidate.peerId
    if (!Number.isSafeInteger(messageId) || messageId <= 0 || !peerId) continue
    const messageKey = `${peerId}:${messageId}`
    if (seenMessages.has(messageKey)) continue
    seenMessages.add(messageKey)

    const state = manifest?.status ?? (attachments.length > 0 ? 'partial' : 'queued')
    entries.push({
      peerId,
      messageId,
      state,
      peerTitle: source.peer?.titleSnapshot,
      senderName: (manifest?.senderSnapshot ?? (source as MetaLike).sender)?.name,
      forwardSource: source.forwardSource,
      groupedId: source.groupedId,
      savedAt: manifest?.savedAt ?? meta?.updatedAt,
      size: received || expected,
      attachmentCount: attachments.length,
      // 视频主文件可能很大：只有真正的照片回退用主文件；视频必须等待独立缩略图。
      thumbnailMediaKey: source.thumbnail?.mediaKey ?? (attachments[0]?.kind === 'photo' ? attachments[0]?.mediaKey : undefined),
      progress: state === 'complete'
        ? 1
        : (expected > 0 ? Math.min(1, received / expected) : 0),
      textPreview: await readContentPreview(messageDir, manifest?.text?.file),
      messageLink: buildMessageLink(peerId, messageId, source.peer?.username),
      localDir: messageDir,
      relativeDir: toArchiveRelativePath(messageDir),
    })
  }

  logger.debug('archive library listed', {
    elapsedMs: Date.now() - startedAt,
    candidates: candidates.length,
    entries: entries.length,
  })
  return entries
}
