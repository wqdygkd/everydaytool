export const PIKPAK_GET_IPC_CHANNELS = {
  // 引擎连接
  CONNECTION_GET: 'pikpak-get:connection:get',
  CONNECTION_SET: 'pikpak-get:connection:set',
  CONNECTION_TEST: 'pikpak-get:connection:test',
  // 账号池
  ACCOUNTS_LIST: 'pikpak-get:accounts:list',
  ACCOUNTS_LOGIN: 'pikpak-get:accounts:login',
  ACCOUNTS_REFRESH: 'pikpak-get:accounts:refresh',
  ACCOUNTS_REVEAL_PASSWORD: 'pikpak-get:accounts:reveal-password',
  ACCOUNTS_WHOAMI: 'pikpak-get:accounts:whoami',
  ACCOUNTS_LOGOUT: 'pikpak-get:accounts:logout',
  // 分享链接
  LINKS_LIST: 'pikpak-get:links:list',
  LINKS_ADD: 'pikpak-get:links:add',
  LINKS_UPDATE: 'pikpak-get:links:update',
  LINKS_DELETE: 'pikpak-get:links:delete',
  LINKS_PARSE: 'pikpak-get:links:parse',
  LINKS_RESET_RECORDS: 'pikpak-get:links:reset-records',
  // 数据导入导出
  DATA_EXPORT: 'pikpak-get:data:export',
  DATA_IMPORT: 'pikpak-get:data:import',
  // 下载任务
  TASKS_LIST: 'pikpak-get:tasks:list',
  TASKS_GET: 'pikpak-get:tasks:get',
  TASKS_START: 'pikpak-get:tasks:start',
  TASKS_CANCEL: 'pikpak-get:tasks:cancel',
} as const

export type PikpakGetIpcChannel = (typeof PIKPAK_GET_IPC_CHANNELS)[keyof typeof PIKPAK_GET_IPC_CHANNELS]
