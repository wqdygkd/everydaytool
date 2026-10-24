// treease-editor 工具域 命令通道（前后端共享）。
export const TREEASE_COMMANDS = {
  INTERCEPT_START: 'treease:intercept-start',
  INTERCEPT_STOP: 'treease:intercept-stop',
  INTERCEPT_UPDATE_RULES: 'treease:intercept-update-rules',
  INTERCEPT_STATUS: 'treease:intercept-status',
  CACHE_CLEAR: 'treease:cache-clear',
  EVENT_INTERCEPT_LOG: 'treease:intercept-log',
} as const

export type TreeaseCommand = (typeof TREEASE_COMMANDS)[keyof typeof TREEASE_COMMANDS]
