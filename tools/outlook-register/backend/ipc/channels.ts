export const OUTLOOK_REGISTER_IPC_CHANNELS = {
  GET_STATE: 'outlook-register:get-state',
  CREATE_DRAFT: 'outlook-register:create-draft',
  UPDATE_DRAFT: 'outlook-register:update-draft',
  DISCARD_DRAFT: 'outlook-register:discard-draft',
  SAVE_ACCOUNT: 'outlook-register:save-account',
  ADD_ACCOUNT: 'outlook-register:add-account',
  UPDATE_ACCOUNT: 'outlook-register:update-account',
  DELETE_ACCOUNT: 'outlook-register:delete-account',
  RESET_SESSION: 'outlook-register:reset-session',
  REVEAL_PASSWORD: 'outlook-register:reveal-password',
  UPDATE_SETTINGS: 'outlook-register:update-settings',
  PREPARE_MAILBOX: 'outlook-register:prepare-mailbox',
} as const

export type OutlookRegisterIpcChannel = (typeof OUTLOOK_REGISTER_IPC_CHANNELS)[keyof typeof OUTLOOK_REGISTER_IPC_CHANNELS]
