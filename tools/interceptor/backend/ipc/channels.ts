// Bundled into dist-electron/electron/preload.cjs by scripts/build-electron.mjs.
export const INTERCEPTOR_IPC_CHANNELS = {
  STATUS_GET: 'interceptor:status:get',
  CA_STATUS_GET: 'interceptor:ca:status',
  CA_INSTALL: 'interceptor:ca:install',
  CA_UNINSTALL: 'interceptor:ca:uninstall',
  CA_EXPORT: 'interceptor:ca:export',
  TARGETS_GET: 'interceptor:targets:get',
  TARGETS_ADD: 'interceptor:targets:add',
  TARGETS_REMOVE: 'interceptor:targets:remove',
  RULES_GET: 'interceptor:rules:get',
  RULES_UPSERT: 'interceptor:rules:upsert',
  RULES_DELETE: 'interceptor:rules:delete',
  TRAFFIC_GET: 'interceptor:traffic:get',
  TRAFFIC_CLEAR: 'interceptor:traffic:clear',
  PROXY_SET_DESIRED: 'interceptor:proxy:set-desired',
  EXTENSION_OPEN_DIR: 'interceptor:extension:open-dir',
  // 主进程 → 渲染层推送（EVENT_ 开头，preload on() 白名单要求）
  EVENT_STATUS: 'interceptor:event:status',
  EVENT_TARGETS: 'interceptor:event:targets',
  EVENT_TRAFFIC: 'interceptor:event:traffic',
} as const

export type InterceptorIpcChannel = (typeof INTERCEPTOR_IPC_CHANNELS)[keyof typeof INTERCEPTOR_IPC_CHANNELS]
