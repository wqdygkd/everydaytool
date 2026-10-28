export const TREEASE_EDITOR_IPC_CHANNELS = {
  INTERCEPT_START: 'treease:intercept-start',
  INTERCEPT_STOP: 'treease:intercept-stop',
  INTERCEPT_UPDATE_RULES: 'treease:intercept-update-rules',
  INTERCEPT_STATUS: 'treease:intercept-status',
  CACHE_CLEAR: 'treease:cache-clear',
  // 规则 / 开关落配置层文件（LocalStorage 只做镜像）
  RULES_GET: 'treease:rules-get',
  RULES_SET: 'treease:rules-set',
  EVENT_INTERCEPT_LOG: 'treease:intercept-log',
} as const

export type TreeaseEditorIpcChannel = (typeof TREEASE_EDITOR_IPC_CHANNELS)[keyof typeof TREEASE_EDITOR_IPC_CHANNELS]
