// tweb-cache 的归档引擎：站点托管、消息级缓存、影库与回收站。
// 数据固定落在 <assets>/tweb-cache/…，不再有跨工具作用域。
import type { ArchiveLibraryEntry, ArchiveMessageState, ArchiveTrashEntry } from '../../../../shared/media-archive.ts'
import { existsSync } from 'node:fs'
import { shell } from 'electron'
import { handleArchiveApi } from './api.ts'
import { getArchiveMediaStatuses, resolveArchiveMedia } from './media-resolver.ts'
import { listArchiveLibrary } from './message-library.ts'
import {
  archiveMessageDir,
  listArchiveMessageMedia,
  normalizeArchiveLibrary,
} from './message-store.ts'
import { getArchiveMessagesRoot } from './paths.ts'
import { startArchiveSiteServer, stopArchiveSiteServer } from './site-server.ts'
import {
  emptyArchiveTrash,
  listArchiveTrash,
  moveArchiveMessageToTrash,
  restoreArchiveTrash,
} from './trash-service.ts'

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

export async function startArchiveSite(options: ArchiveSiteOptions): Promise<ArchiveSiteHandle> {
  const info = await startArchiveSiteServer({
    rootDir: options.rootDir,
    extraRootDir: options.extraRootDir,
    port: options.port,
    portRange: options.portRange,
    apiVersion: options.apiVersion,
    resolveMedia: resolveArchiveMedia,
    getMediaStatus: getArchiveMediaStatuses,
    handleApi: handleArchiveApi,
  })
  return {
    url: info.url,
    port: info.port,
    token: info.token,
    stop: () => stopArchiveSiteServer(),
  }
}

export function getMediaStatuses(keys: string[]): unknown {
  return getArchiveMediaStatuses(keys)
}

export function listLibrary(): Promise<ArchiveLibraryEntry[]> {
  return listArchiveLibrary()
}

export function listMessageMedia(peerId: string, messageId: number) {
  return listArchiveMessageMedia(peerId, messageId)
}

export function normalizeLibrary(): Promise<{ messages: number, changed: number, migrated: number }> {
  return normalizeArchiveLibrary()
}

export async function deleteMessage(peerId: string, messageId: number): Promise<{ state: ArchiveMessageState }> {
  await moveArchiveMessageToTrash(peerId, messageId)
  return { state: 'missing' }
}

export async function revealMessageDir(peerId: string, messageId: number): Promise<void> {
  const dir = archiveMessageDir(peerId, messageId)
  if (!existsSync(dir)) throw new Error('本地没有该消息缓存')
  shell.showItemInFolder(dir)
}

export function listTrash(): Promise<ArchiveTrashEntry[]> {
  return listArchiveTrash()
}

export async function restoreTrash(trashId: string): Promise<{ state: ArchiveMessageState }> {
  const restored = await restoreArchiveTrash(trashId)
  return { state: restored.state }
}

export function emptyTrash(olderThanDays?: number): Promise<number> {
  return emptyArchiveTrash(olderThanDays)
}

export function getMessagesRoot(): string {
  return getArchiveMessagesRoot()
}
