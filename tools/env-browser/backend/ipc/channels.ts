// Bundled into dist-electron/electron/preload.cjs by scripts/build-electron.mjs.
export const ENV_BROWSER_IPC_CHANNELS = {
  ENV_GET_ALL: 'env-browser:get-all',
  ENV_CREATE: 'env-browser:create',
  ENV_UPDATE: 'env-browser:update',
  ENV_DELETE: 'env-browser:delete',
} as const

export type EnvBrowserIpcChannel = (typeof ENV_BROWSER_IPC_CHANNELS)[keyof typeof ENV_BROWSER_IPC_CHANNELS]
