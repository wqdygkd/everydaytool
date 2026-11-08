// peer 目录名（`messages/<这里>/<消息 id>/`）只有两种形态：
//   `<username>-peer-<peerId>`（有 username，username 只用于浏览时辨认）
//   `peer-<peerId>`           （没有 username）
// 映射落在 `<config>/tweb-cache/peer-dirs.json`。
//
// 真实身份永远是 peer id：username 变了会跟着改名，但只做一次目录 rename + media-index 重写，
// manifest 里的媒体路径是「相对消息目录」的（`media/<file>`），不随 peer 目录变化。
import type { ArchiveMessagePeerSnapshot } from '../../../../shared/media-archive.ts'
import path from 'node:path'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { getArchiveConfigRoot } from './paths.ts'

export interface ArchivePeerDirEntry {
  dir: string
  username?: string
  title?: string
  updatedAt: number
}

interface ArchivePeerDirDocument {
  schemaVersion: 1
  peers: Record<string, ArchivePeerDirEntry>
}

const PEER_ID_PATTERN = /^-?\d{1,20}$/
const LEGACY_PREFIX = 'peer-'
const MAX_DIR_LENGTH = 64
/** Telegram username：字母 / 数字 / 下划线 */
const USERNAME_PATTERN = /^\w{1,32}$/
/** Windows 保留设备名（不含扩展名时同样不可用） */
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
/** 文件系统不允许的字符 + 控制字符 */
const ILLEGAL_DIR_CHARS_TEST = /[<>:"/\\|?*\p{Cc}]/u

function peerDirPath(): string {
  return path.join(getArchiveConfigRoot(), 'peer-dirs.json')
}

function readDocument(): ArchivePeerDirDocument {
  const document = readJsonDocument<Partial<ArchivePeerDirDocument>>(peerDirPath(), () => ({
    schemaVersion: 1,
    peers: {},
  }))
  return {
    schemaVersion: 1,
    peers: typeof document?.peers === 'object' && document.peers !== null
      ? document.peers as Record<string, ArchivePeerDirEntry>
      : {},
  }
}

function isUsableDirName(name: string): boolean {
  if (!name || name === '.' || name === '..' || name.length > MAX_DIR_LENGTH) return false
  if (ILLEGAL_DIR_CHARS_TEST.test(name)) return false
  if (!name.trim() || name.endsWith('.') || name.endsWith(' ')) return false
  return !WINDOWS_RESERVED.test(name)
}

export function isLegacyPeerDir(dir: string): boolean {
  return dir.startsWith(LEGACY_PREFIX) && PEER_ID_PATTERN.test(dir.slice(LEGACY_PREFIX.length))
}

/** 可用的 username；空 / 非法一律当作「没有 username」 */
function usableUsername(username?: string): string | undefined {
  const value = username?.trim()
  return value && USERNAME_PATTERN.test(value) && isUsableDirName(value) ? value : undefined
}

/**
 * 规范目录名：`<username>-peer-<peerId>`；没有 username 时就是 `peer-<peerId>`。
 * 带 peer id 是为了让不同会话不可能同名，也让 username 变化时能安全改名。
 */
export function preferredPeerDir(peer: ArchiveMessagePeerSnapshot): string {
  const legacy = `${LEGACY_PREFIX}${peer.id}`
  const username = usableUsername(peer.username)
  if (!username) return legacy
  const name = `${username}-${legacy}`
  return isUsableDirName(name) ? name : legacy
}

/** 当前 peer 的目录名；未登记时用 `peer-<id>`（无 username 的规范名，也是旧归档布局） */
export function getArchivePeerDir(peerId: string): string {
  if (!PEER_ID_PATTERN.test(peerId)) return `${LEGACY_PREFIX}${peerId}`
  const entry = readDocument().peers[peerId]
  if (entry && typeof entry.dir === 'string' && isUsableDirName(entry.dir)) return entry.dir
  return `${LEGACY_PREFIX}${peerId}`
}

export function getArchivePeerEntry(peerId: string): ArchivePeerDirEntry | undefined {
  if (!PEER_ID_PATTERN.test(peerId)) return undefined
  return readDocument().peers[peerId]
}

/** 目录名 → peer id（大小写不敏感，兼容 Windows / macOS） */
export function findArchivePeerIdByDir(dir: string): string | undefined {
  const needle = dir.toLowerCase()
  for (const [peerId, entry] of Object.entries(readDocument().peers)) {
    if (entry?.dir?.toLowerCase() === needle) return peerId
  }
  return undefined
}

export function setArchivePeerEntry(peerId: string, entry: Omit<ArchivePeerDirEntry, 'updatedAt'>): void {
  if (!PEER_ID_PATTERN.test(peerId) || !isUsableDirName(entry.dir)) return
  const document = readDocument()
  const current = document.peers[peerId]
  // 每条消息 prepare 都会调一次登记：值没变就不落盘，避免缓存大相册时反复重写小 JSON
  if (current?.dir === entry.dir && current.username === entry.username && current.title === entry.title) return
  document.peers[peerId] = { ...entry, updatedAt: Date.now() }
  writeJsonDocument(peerDirPath(), document)
}
