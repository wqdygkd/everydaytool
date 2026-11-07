// 消息级本地归档的共享契约：纯类型 / 常量，前端与 Electron 主进程共用。
// 数据按工具命名空间隔离，当前仅 tweb-cache 使用。

/** 本地响应类别：none = 永不复用；image = 图片整份；media = 音视频（单区间 206） */
export type ArchiveServeClass = 'none' | 'image' | 'media'

/** 图片类资源的 MIME 前缀（本地响应默认只做图片；音视频走单区间 Range） */
export const ARCHIVE_LOCAL_RESPONSE_MIME_PREFIX = 'image/'

export type ArchiveMessageState = 'missing' | 'queued' | 'downloading' | 'partial' | 'complete' | 'failed'
export type ArchiveAttachmentState = 'pending' | 'partial' | 'complete' | 'failed'
export type ArchiveMediaLinkMode = 'hardlink' | 'copy' | 'object'

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
  /** 相对工具命名空间（assets 层）的路径，如 `messages/peer-<peerId>/<mid>/media/<mediaKey>.jpg` */
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
}

export interface ArchiveTrashEntry {
  trashId: string
  deletedAt: number
  expiresAt: number
  originalPath: string
  peerId: string
  messageId: number
}
