// offline-pack 工具域 命令通道（前后端共享）。
export const OFFLINE_PACK_COMMANDS = {
  // VSCode
  VSCODE_QUERY: 'offline-pack:vscode:query',
  VSCODE_LINK: 'offline-pack:vscode:link',
  // Chrome
  CHROME_SEARCH: 'offline-pack:chrome:search',
  CHROME_DETAIL: 'offline-pack:chrome:detail',
  // Edge
  EDGE_SEARCH: 'offline-pack:edge:search',
  EDGE_DETAIL: 'offline-pack:edge:detail',
  // Docker
  DOCKER_SEARCH: 'offline-pack:docker:search',
  DOCKER_TAGS: 'offline-pack:docker:tags',
  DOCKER_PLATFORMS: 'offline-pack:docker:platforms',
  DOCKER_MANIFEST: 'offline-pack:docker:manifest',
  // MSStore
  MSSTORE_RESOLVE: 'offline-pack:msstore:resolve',
  // 下载
  DOWNLOAD: 'offline-pack:download',
  CANCEL_DOWNLOAD: 'offline-pack:download:cancel',
  OPEN_DIR: 'offline-pack:open-dir',
  // 下载历史
  HISTORY_LIST: 'offline-pack:history:list',
  HISTORY_DELETE: 'offline-pack:history:delete',
  HISTORY_CLEAR: 'offline-pack:history:clear',
  // 事件（主进程 → 渲染层推送）
  EVENT_PROGRESS: 'offline-pack:event:progress',
} as const

export type OfflinePackCommand = (typeof OFFLINE_PACK_COMMANDS)[keyof typeof OFFLINE_PACK_COMMANDS]
