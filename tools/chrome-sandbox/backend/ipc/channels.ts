// Chrome 沙箱 IPC 通道表：命令值统一 `<工具 id>:<域>:<动作>`，事件值统一
// `<工具 id>:event:<名称>`（EVENT_ 键前缀供 preload 区分「只收不发」的事件通道）。
// 经 electron/ipc-namespaces.ts 注入 preload 命名空间 chromeSandbox 的通道白名单。
export const CHROME_SANDBOX_IPC_CHANNELS = {
  SANDBOX_CREATE: 'chrome-sandbox:sandbox:create',
  SANDBOX_DELETE: 'chrome-sandbox:sandbox:delete',
  SANDBOX_ACTIVATE: 'chrome-sandbox:sandbox:activate',
  SANDBOX_CLOSE: 'chrome-sandbox:sandbox:close',
  SANDBOX_GET_ALL: 'chrome-sandbox:sandbox:get-all',
  SANDBOX_UPDATE: 'chrome-sandbox:sandbox:update',
  SANDBOX_REFRESH_STATUS: 'chrome-sandbox:sandbox:refresh-status',
  FINGERPRINT_UPDATE: 'chrome-sandbox:fingerprint:update',
  FINGERPRINT_GET_BY_ID: 'chrome-sandbox:fingerprint:get-by-id',
  FINGERPRINT_GENERATE_RANDOM: 'chrome-sandbox:fingerprint:generate-random',
  CHROME_DETECT_PATH: 'chrome-sandbox:chrome:detect-path',
  CONFIG_GET: 'chrome-sandbox:config:get',
  CONFIG_UPDATE: 'chrome-sandbox:config:update',
  CONFIG_SELECT_DATA_DIRECTORY: 'chrome-sandbox:config:select-data-directory',
  EVENT_STATUS_CHANGED: 'chrome-sandbox:event:status-changed',
  EVENT_PROCESS_EXITED: 'chrome-sandbox:event:process-exited',
} as const

export type ChromeSandboxIpcChannel = (typeof CHROME_SANDBOX_IPC_CHANNELS)[keyof typeof CHROME_SANDBOX_IPC_CHANNELS]
