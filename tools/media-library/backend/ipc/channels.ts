/**
 * 媒体库 IPC 通道表。
 * 通道字符串集中定义在 shared，preload 与主进程共用，避免两侧漂移。
 * 以 `EVENT_` 开头的键是主进程 → 渲染层的推送通道（只允许监听）。
 */
import { MEDIA_LIBRARY_CHANNELS } from '../../../../shared/media-library.ts'

export const MEDIA_LIBRARY_IPC_CHANNELS = { ...MEDIA_LIBRARY_CHANNELS } as const

export type MediaLibraryIpcChannel = (typeof MEDIA_LIBRARY_IPC_CHANNELS)[keyof typeof MEDIA_LIBRARY_IPC_CHANNELS]
