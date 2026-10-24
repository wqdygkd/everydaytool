// env-browser 工具域 命令通道（前后端共享）。
export const ENV_BROWSER_COMMANDS = {
  ENV_GET_ALL: 'env-browser:get-all',
  ENV_CREATE: 'env-browser:create',
  ENV_UPDATE: 'env-browser:update',
  ENV_DELETE: 'env-browser:delete',
} as const

export type EnvBrowserCommand = (typeof ENV_BROWSER_COMMANDS)[keyof typeof ENV_BROWSER_COMMANDS]
