// wxp-enhancer 工具域 命令通道（前后端共享）。
export const WXP_COMMANDS = {
  GET_ALL: 'wxp:get-all',
  SAVE_SETTINGS: 'wxp:save-settings',
  SELECT_EXECUTABLE: 'wxp:select-executable',
  DETECT_EXECUTABLE: 'wxp:detect-executable',
  LAUNCH: 'wxp:launch',
  STOP: 'wxp:stop',
  REINJECT: 'wxp:reinject',
  CLEAR_LOGIN_CACHE: 'wxp:clear-login-cache',
  GET_DATA_CACHE: 'wxp:get-data-cache',
  COLLECT_DATA: 'wxp:collect-data',
  EVENT_STATUS_CHANGED: 'wxp:status-changed',
  EVENT_DATA_CACHE_UPDATED: 'wxp:data-cache-updated',
} as const

export type WxpCommand = (typeof WXP_COMMANDS)[keyof typeof WXP_COMMANDS]
