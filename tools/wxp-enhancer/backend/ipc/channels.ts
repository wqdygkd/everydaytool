export const WXP_IPC_CHANNELS = {
  GET_ALL: 'wxp:get-all',
  SAVE_SETTINGS: 'wxp:save-settings',
  ENHANCEMENT_SAVE: 'wxp:enhancement-save',
  ENHANCEMENT_DELETE: 'wxp:enhancement-delete',
  SELECT_EXECUTABLE: 'wxp:select-executable',
  DETECT_EXECUTABLE: 'wxp:detect-executable',
  LAUNCH: 'wxp:launch',
  STOP: 'wxp:stop',
  REINJECT: 'wxp:reinject',
  CLEAR_LOGIN_CACHE: 'wxp:clear-login-cache',
  GET_DATA_CACHE: 'wxp:get-data-cache',
  COLLECT_DATA: 'wxp:collect-data',
  EVENT_STATUS_CHANGED: 'wxp:status-changed',
} as const

export type WxpIpcChannel = (typeof WXP_IPC_CHANNELS)[keyof typeof WXP_IPC_CHANNELS]
