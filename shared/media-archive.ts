// 消息级本地归档的共享契约：纯类型 / 常量，前端与 Electron 主进程共用。
// 数据按工具命名空间隔离，当前仅 tweb-cache 使用。

/** 本地响应类别：none = 永不复用；image = 图片整份；media = 音视频（单区间 206） */
export type ArchiveServeClass = 'none' | 'image' | 'media'

/** 图片类资源的 MIME 前缀（本地响应默认只做图片；音视频走单区间 Range） */
export const ARCHIVE_LOCAL_RESPONSE_MIME_PREFIX = 'image/'

export type ArchiveMessageState = 'missing' | 'queued' | 'downloading' | 'partial' | 'complete' | 'failed'
export type ArchiveAttachmentState = 'pending' | 'partial' | 'complete' | 'failed'
export type ArchiveMediaLinkMode = 'hardlink' | 'copy' | 'object'
/**
 * `complete` 的来源：
 * - direct：本条消息自己有完整缓存；
 * - source：本条是转发，缓存落在转发源消息上；
 * - forward：本条是源消息，缓存落在某份转发副本上；
 * - media：本条没有直接缓存，但同媒体 + 同正文长度的其它消息已缓存。
 */
export type ArchiveStatusVia = 'direct' | 'source' | 'forward' | 'media'

export interface ArchiveMessagePeerSnapshot {
  id: string
  username?: string
  titleSnapshot?: string
  type?: string
}

export interface ArchiveForwardSourceSnapshot {
  id?: string
  titleSnapshot?: string
  username?: string
  name?: string
  messageId?: number
  date?: string
}

export interface ArchiveThumbnailSnapshot {
  mediaKey: string
  mimeType: string
  size: number
  /** 相对消息目录（`media/<file>`），peer 目录改名不受影响 */
  relativePath: string
  savedAt: number
}

export interface ArchiveMessageAttachment {
  index: number
  mediaKey: string
  kind: string
  mimeType?: string
  fileName?: string
  expectedSize?: number
  actualSize?: number
  sha256?: string
  /** 相对消息目录的路径（`media/<mediaKey>.jpg`）；旧归档可能是完整 `messages/…`，读取时兼容 */
  relativePath?: string
  linkMode?: ArchiveMediaLinkMode
  status: ArchiveAttachmentState
}

export interface ArchiveMessageManifest {
  schemaVersion: 1
  messageKey: string
  peer: ArchiveMessagePeerSnapshot
  messageId: number
  groupedId?: string
  date?: string
  editDate?: string
  senderSnapshot?: { id?: string, name?: string }
  forwardSource?: ArchiveForwardSourceSnapshot
  thumbnail?: ArchiveThumbnailSnapshot
  text?: { saved: boolean, chars: number, truncated?: boolean, file?: string }
  status: ArchiveMessageState
  attachments: ArchiveMessageAttachment[]
  origin?: { reachable?: boolean, lastCheckedAt?: number }
  savedAt: number
  updatedAt: number
}

export interface ArchivePrepareAttachment {
  index: number
  mediaKey: string
  kind: string
  mimeType?: string
  fileName?: string
  expectedSize?: number
}

export interface ArchivePrepareRequest {
  peer: ArchiveMessagePeerSnapshot
  messageId: number
  groupedId?: string
  date?: string
  editDate?: string
  sender?: { id?: string, name?: string }
  forwardSource?: ArchiveForwardSourceSnapshot
  /** 正文（提前送来，进行中的目录也能读出内容） */
  text?: string
  textTruncated?: boolean
  attachments: ArchivePrepareAttachment[]
}

export interface ArchiveAttachmentProgress {
  index: number
  mediaKey: string
  received: number
  expected: number
  complete: boolean
}

export interface ArchivePrepareResponse {
  state: ArchiveMessageState
  attachments: ArchiveAttachmentProgress[]
  thumbnailSaved?: boolean
}

export interface ArchiveAppendResponse {
  received: number
  expected: number
  complete: boolean
}

export interface ArchiveCommitRequest {
  peer: ArchiveMessagePeerSnapshot
  messageId: number
  text?: string
  textTruncated?: boolean
}

export interface ArchiveMessageStatusEntry {
  state: ArchiveMessageState
  received?: number
  expected?: number
  progress?: number
  attachments?: number
  savedAt?: number
  error?: string
  /** 仅 complete 时有意义；省略等价于 direct */
  via?: ArchiveStatusVia
  /** via 非 direct 时，实际承载缓存的消息（用于“在文件夹中显示”等操作） */
  resolved?: { peerId: string, messageId: number }
}

/** 页面查询状态时提供的等价线索（可选，用于识别转发 / 同内容副本） */
export interface ArchiveMessageStatusHint {
  messageId: number
  /** 转发源快照：只有同时含 id 与 messageId 时才用于精确关联 */
  forwardSource?: ArchiveForwardSourceSnapshot
  /** 本条消息的媒体 key（`photo_<id>` / `document_<id>`），用于内容签名匹配 */
  mediaKeys?: string[]
  /** 本条消息正文长度（与 mediaKeys 一起构成内容签名） */
  textChars?: number
}

export interface ArchiveLibraryEntry {
  peerId: string
  messageId: number
  state: ArchiveMessageState
  peerTitle?: string
  senderName?: string
  forwardSource?: ArchiveForwardSourceSnapshot
  groupedId?: string
  thumbnailMediaKey?: string
  thumbnailUrl?: string
  savedAt?: number
  size: number
  attachmentCount: number
  /** 0..1；进行中（partial/queued）才有意义 */
  progress?: number
  textPreview?: string
  /** 可在 Telegram 里定位该消息的链接（展示/复制用；点击走内嵌页面跳转） */
  messageLink: string
  /** 消息目录的绝对路径（「打开文件夹」与提示用） */
  localDir: string
  /** 相对 assets 根的消息目录 */
  relativeDir: string
}

/** 主进程 → 渲染层的影库状态推送（一次一条消息，进度变化会连续推送） */
export interface ArchiveLibraryEvent {
  peerId: string
  messageId: number
  state: ArchiveMessageState
  received?: number
  expected?: number
  progress?: number
  via?: ArchiveStatusVia
  resolved?: { peerId: string, messageId: number }
}

export interface ArchiveTrashEntry {
  trashId: string
  deletedAt: number
  expiresAt: number
  originalPath: string
  peerId: string
  messageId: number
}
