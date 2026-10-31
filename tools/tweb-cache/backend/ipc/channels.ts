// tweb-cache 的 IPC 通道（独立命名空间，与 telegram-cache 互不影响）。
// 全部为窄接口：peerId / messageId / trashId / 数字，不接受路径或 URL。
import { TWEB_ARCHIVE_LIBRARY_EVENT_CHANNEL } from '../../../../shared/telegram-cache.ts'

export const TWEB_CACHE_IPC_CHANNELS = {
  SITE_INFO: 'tweb-cache:site:info',
  // 影库 / 回收站：由平台归档引擎按 tweb-cache scope 提供数据
  LIBRARY_LIST: 'tweb-cache:library:list',
  LIBRARY_DELETE: 'tweb-cache:library:delete',
  LIBRARY_OPEN_DIR: 'tweb-cache:library:open-dir',
  LIBRARY_NORMALIZE: 'tweb-cache:library:normalize',
  // 回收站
  TRASH_LIST: 'tweb-cache:trash:list',
  TRASH_RESTORE: 'tweb-cache:trash:restore',
  TRASH_EMPTY: 'tweb-cache:trash:empty',
  // 目录
  OPEN_DATA_DIR: 'tweb-cache:open-data-dir',
  // 主进程 → 渲染层：归档状态 / 进度推送
  EVENT_LIBRARY: TWEB_ARCHIVE_LIBRARY_EVENT_CHANNEL,
} as const

export type TwebCacheIpcChannel = (typeof TWEB_CACHE_IPC_CHANNELS)[keyof typeof TWEB_CACHE_IPC_CHANNELS]
