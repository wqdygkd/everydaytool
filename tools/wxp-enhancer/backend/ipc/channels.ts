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
  GET_TARGETS: 'wxp:get-targets',
  OPEN_DEVTOOLS: 'wxp:open-devtools',
  EVENT_STATUS_CHANGED: 'wxp:status-changed',
} as const

export type WxpIpcChannel = (typeof WXP_IPC_CHANNELS)[keyof typeof WXP_IPC_CHANNELS]
