// 本地影库（v4）：扫描 messages/<acc>/<peer>/<mid>/，给工具侧 library 面板提供只读列表。
// 不访问网络、不调用 MTProto；manifest 缺失时按 archive.meta.json 标为 partial。
import type { TelegramLibraryEntry, TelegramMessageState } from '../../../../shared/telegram-cache.ts'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { getTelegramMessagesRoot } from '../utils/paths.ts'

const MAX_ENTRIES = 500
const TEXT_PREVIEW_CHARS = 160

interface ManifestLike {
  peer?: { id?: string, titleSnapshot?: string }
  messageId?: number
  groupedId?: string
  savedAt?: number
  status?: TelegramMessageState
  attachments?: Array<{ actualSize?: number, expectedSize?: number, mediaKey?: string }>
}

interface MetaLike {
  peer?: { id?: string, titleSnapshot?: string }
  messageId?: number
  groupedId?: string
  updatedAt?: number
  attachments?: Array<{ actualSize?: number, received?: number, expectedSize?: number, mediaKey?: string }>
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch {
    return undefined
  }
}

async function readTextPreview(dir: string): Promise<string | undefined> {
  try {
    const text = await readFile(path.join(dir, 'text.md'), 'utf8')
    return text.replace(/\s+/g, ' ').trim().slice(0, TEXT_PREVIEW_CHARS) || undefined
  } catch {
    return undefined
  }
}

export async function listTelegramLibrary(): Promise<TelegramLibraryEntry[]> {
  const root = getTelegramMessagesRoot()
  const entries: TelegramLibraryEntry[] = []

  const accounts = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const account of accounts) {
    if (!account.isDirectory()) continue
    const accountDir = path.join(root, account.name)
    const peers = await readdir(accountDir, { withFileTypes: true }).catch(() => [])
    for (const peer of peers) {
      if (!peer.isDirectory() || !peer.name.startsWith('peer-')) continue
      const peerDir = path.join(accountDir, peer.name)
      const messages = await readdir(peerDir, { withFileTypes: true }).catch(() => [])
      for (const message of messages) {
        if (!message.isDirectory()) continue
        const messageDir = path.join(peerDir, message.name)
        const manifest = await readJson<ManifestLike>(path.join(messageDir, 'manifest.json'))
        const meta = manifest ? undefined : await readJson<MetaLike>(path.join(messageDir, 'archive.meta.json'))
        const source = manifest ?? meta
        if (!source) continue

        const attachments = source.attachments ?? []
        const size = attachments.reduce((total, item) => (
          total + (item.actualSize ?? (item as { received?: number }).received ?? item.expectedSize ?? 0)
        ), 0)
        const messageId = source.messageId ?? Number(message.name)
        const peerId = source.peer?.id ?? peer.name.replace(/^peer-/, '')
        if (!Number.isSafeInteger(messageId) || messageId <= 0 || !peerId) continue

        entries.push({
          peerId,
          messageId,
          state: manifest?.status ?? (attachments.length > 0 ? 'partial' : 'queued'),
          peerTitle: source.peer?.titleSnapshot,
          groupedId: source.groupedId,
          savedAt: manifest?.savedAt ?? meta?.updatedAt,
          size,
          attachmentCount: attachments.length,
          textPreview: manifest ? await readTextPreview(messageDir) : undefined,
          relativeDir: `messages/${account.name}/${peer.name}/${message.name}`,
        })
        if (entries.length >= MAX_ENTRIES * 2) break
      }
      if (entries.length >= MAX_ENTRIES * 2) break
    }
    if (entries.length >= MAX_ENTRIES * 2) break
  }

  entries.sort((left, right) => (right.savedAt ?? 0) - (left.savedAt ?? 0))
  return entries.slice(0, MAX_ENTRIES)
}
