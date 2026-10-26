export const WB2API_PANEL_IPC_CHANNELS = {
  GET_STATE: 'workbuddy2api-panel:get-state',
  INSTALL: 'workbuddy2api-panel:install',
  INSTALL_FROM_ZIP: 'workbuddy2api-panel:install-from-zip',
  CANCEL_DOWNLOAD: 'workbuddy2api-panel:cancel-download',
  CHECK_UPDATE: 'workbuddy2api-panel:check-update',
  APPLY_UPDATE: 'workbuddy2api-panel:apply-update',
  START: 'workbuddy2api-panel:start',
  STOP: 'workbuddy2api-panel:stop',
  RESTART: 'workbuddy2api-panel:restart',
  KILL_ORPHAN: 'workbuddy2api-panel:kill-orphan',
  OPEN_DATA_DIR: 'workbuddy2api-panel:open-data-dir',
  EVENT_STATE: 'workbuddy2api-panel:event:state',
  EVENT_PROGRESS: 'workbuddy2api-panel:event:progress',
} as const

export type Wb2apiPanelIpcChannel = (typeof WB2API_PANEL_IPC_CHANNELS)[keyof typeof WB2API_PANEL_IPC_CHANNELS]
