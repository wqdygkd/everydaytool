// Bundled into dist-electron/electron/preload.cjs by scripts/build-electron.mjs.
export const BROWSER_BRIDGE_IPC_CHANNELS = {
  STATUS_GET: 'browser-bridge:status:get',
  CA_STATUS_GET: 'browser-bridge:ca:status',
  CA_INSTALL: 'browser-bridge:ca:install',
  CA_UNINSTALL: 'browser-bridge:ca:uninstall',
  CA_EXPORT: 'browser-bridge:ca:export',
  TARGETS_GET: 'browser-bridge:targets:get',
  TARGETS_ADD: 'browser-bridge:targets:add',
  TARGETS_REMOVE: 'browser-bridge:targets:remove',
  RULES_GET: 'browser-bridge:rules:get',
  RULES_UPSERT: 'browser-bridge:rules:upsert',
  RULES_DELETE: 'browser-bridge:rules:delete',
  TRAFFIC_GET: 'browser-bridge:traffic:get',
  TRAFFIC_CLEAR: 'browser-bridge:traffic:clear',
  PROXY_SET_DESIRED: 'browser-bridge:proxy:set-desired',
  EXTENSION_OPEN_DIR: 'browser-bridge:extension:open-dir',
  // 主进程 → 渲染层推送（EVENT_ 开头，preload on() 白名单要求）
  EVENT_STATUS: 'browser-bridge:event:status',
  EVENT_TARGETS: 'browser-bridge:event:targets',
  EVENT_TRAFFIC: 'browser-bridge:event:traffic',
} as const

export type BrowserBridgeIpcChannel = (typeof BROWSER_BRIDGE_IPC_CHANNELS)[keyof typeof BROWSER_BRIDGE_IPC_CHANNELS]
