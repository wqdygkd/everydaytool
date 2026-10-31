// 本地影库（v4）：扫描 messages/peer-<群 id>/<消息 id>/，给工具侧 library 面板提供只读列表。
// 不访问网络、不调用 MTProto；manifest 缺失时按 archive.meta.json 标为 partial。
import type { TelegramForwardSourceSnapshot, TelegramLibraryEntry, TelegramMessageState } from '../../../../shared/telegram-cache.ts'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { getTelegramMessagesRoot, toTelegramRelativePath } from '../utils/paths.ts'
import { migrateTelegramAccountLayout } from './message-store.ts'

const MAX_ENTRIES = 500
const TEXT_PREVIEW_CHARS = 160
const CONTENT_FILES = ['message.md', 'text.md']

interface ManifestLike {
  peer?: { id?: string, titleSnapshot?: string, username?: string }
  messageId?: number
  groupedId?: string
  savedAt?: number
  status?: TelegramMessageState
  senderSnapshot?: { name?: string }
  forwardSource?: TelegramForwardSourceSnapshot
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
  forwardSource?: TelegramForwardSourceSnapshot
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

/** 会话/消息 id → 可在 Telegram 里定位该消息的链接 */
function buildMessageLink(peerId: string, messageId: number, username?: string): string {
  if (username) return `https://t.me/${username}/${messageId}`
  if (peerId.startsWith('-100')) return `https://t.me/c/${peerId.slice(4)}/${messageId}`
  if (peerId.startsWith('-')) return `tg://openmessage?chat_id=${peerId}&message_id=${messageId}`
  return `tg://openmessage?user_id=${peerId}&message_id=${messageId}`
}

export async function listTelegramLibrary(): Promise<TelegramLibraryEntry[]> {
  const root = getTelegramMessagesRoot()
  const entries: TelegramLibraryEntry[] = []

  // 旧版 messages/acc-<scope>/ 那一级在这里顺手上移（幂等，每个进程只跑一次）
  await migrateTelegramAccountLayout().catch(() => undefined)
  const peers = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const peer of peers) {
    if (!peer.isDirectory() || !peer.name.startsWith('peer-')) continue
    const peerDir = path.join(root, peer.name)
    const messages = await readdir(peerDir, { withFileTypes: true }).catch(() => [])
    for (const message of messages) {
      if (!message.isDirectory()) continue
      const messageDir = path.join(peerDir, message.name)
      const manifest = await readJson<ManifestLike>(path.join(messageDir, 'manifest.json'))
      const meta = manifest ? undefined : await readJson<MetaLike>(path.join(messageDir, 'archive.meta.json'))
      const source = manifest ?? meta
      if (!source) continue

      const attachments = source.attachments ?? []
      const received = attachments.reduce((total, item) => (
        total + (item.actualSize ?? (item as { received?: number }).received ?? 0)
      ), 0)
      const expected = attachments.reduce((total, item) => total + (item.expectedSize ?? 0), 0)
      const messageId = source.messageId ?? Number(message.name)
      const peerId = source.peer?.id ?? peer.name.replace(/^peer-/, '')
      if (!Number.isSafeInteger(messageId) || messageId <= 0 || !peerId) continue

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
        relativeDir: toTelegramRelativePath(messageDir),
      })
      if (entries.length >= MAX_ENTRIES * 2) break
    }
    if (entries.length >= MAX_ENTRIES * 2) break
  }

  entries.sort((left, right) => (right.savedAt ?? 0) - (left.savedAt ?? 0))
  return entries.slice(0, MAX_ENTRIES)
}
