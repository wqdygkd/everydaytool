export const CDP_IPC_CHANNELS = {
  PROFILE_GET_ALL: 'cdp:profile-get-all',
  PROFILE_SAVE: 'cdp:profile-save',
  PROFILE_DELETE: 'cdp:profile-delete',
  SCRIPT_GET_ALL: 'cdp:script-get-all',
  SCRIPT_SAVE: 'cdp:script-save',
  SCRIPT_DELETE: 'cdp:script-delete',
  SELECT_EXECUTABLE: 'cdp:select-executable',
  SELECT_SCRIPT_FILE: 'cdp:select-script-file',
  LAUNCH: 'cdp:launch',
  LAUNCH_BATCH: 'cdp:launch-batch',
  STOP: 'cdp:stop',
  STOP_ALL: 'cdp:stop-all',
  GET_RUNNING: 'cdp:get-running',
  REINJECT: 'cdp:reinject',
  GET_TARGETS: 'cdp:get-targets',
  OPEN_DEVTOOLS: 'cdp:open-devtools',
  EVENT_STATUS_CHANGED: 'cdp:status-changed',
} as const;

export type CdpIpcChannel = (typeof CDP_IPC_CHANNELS)[keyof typeof CDP_IPC_CHANNELS];
