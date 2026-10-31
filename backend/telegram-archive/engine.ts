// 归档引擎的跨工具契约（依赖倒置）。
//
// 背景：`telegram-cache` 与 `tweb-cache` 是两个**独立工具**（各自的后端 / 站点端口 / IPC 命名空间 /
// 数据目录），但归档的写入逻辑只能有一份。AGENTS.md 禁止工具之间互相 import 对方的 backend，
// 所以这里只放**平台层契约 + 注册表**：
//
//   1. 拥有归档实现的工具（当前是 telegram-cache）在 initialize 时注册；
//   2. 其它工具（tweb-cache）通过 getTelegramArchiveEngine() 取用；
//   3. 每个方法都带 `scope`（工具 id）：存储层按 scope 解析数据分层路径，
//      于是两个工具各写各的 `<assets>/<scope>/messages`，互不干扰。
//
// 约束：本文件只依赖 shared/ 的纯类型，不 import 任何工具域代码。
import type {
  TelegramLibraryEntry,
  TelegramMessageState,
  TelegramTrashEntry,
} from '../../shared/telegram-cache.ts'

/** 起一个本地站点：静态根 + `/api` + `/media` + `/events`（实现由注册方提供） */
export interface ArchiveSiteOptions {
  rootDir: string
  /** 次要静态根（tweb 的 public/：dist 里没有 assets / wasm / 字体） */
  extraRootDir?: string
  port: number
  portRange: number
  apiVersion: string
}

export interface ArchiveSiteHandle {
  url: string
  port: number
  token: string
  stop: () => void
}

export interface ArchiveMediaItem {
  mediaKey: string
  mimeType?: string
  fileName?: string
  size: number
  relativePath: string
}

/**
 * scope = 工具 id（`telegram-cache` / `tweb-cache`）。
 * 存储层据此决定 assets / cache / config 下的命名空间目录。
 */
export interface ArchiveEngine {
  startSite: (scope: string, options: ArchiveSiteOptions) => Promise<ArchiveSiteHandle>
  getSiteMediaStatus: (scope: string, keys: string[]) => unknown
  listLibrary: (scope: string) => Promise<TelegramLibraryEntry[]>
  listMessageMedia: (scope: string, peerId: string, messageId: number) => Promise<ArchiveMediaItem[]>
  normalizeLibrary: (scope: string) => Promise<{ messages: number, changed: number, migrated: number }>
  deleteMessage: (scope: string, peerId: string, messageId: number) => Promise<{ state: TelegramMessageState }>
  revealMessageDir: (scope: string, peerId: string, messageId: number) => Promise<void>
  listTrash: (scope: string) => Promise<TelegramTrashEntry[]>
  restoreTrash: (scope: string, trashId: string) => Promise<{ state: TelegramMessageState }>
  emptyTrash: (scope: string, olderThanDays?: number) => Promise<number>
  getMessagesRoot: (scope: string) => string
}

let registered: ArchiveEngine | undefined

export function registerTelegramArchiveEngine(engine: ArchiveEngine): void {
  registered = engine
}

export function getTelegramArchiveEngine(): ArchiveEngine {
  if (!registered) throw new Error('归档引擎尚未注册：telegram-cache 后端未初始化')
  return registered
}

export function hasTelegramArchiveEngine(): boolean {
  return registered !== undefined
}
