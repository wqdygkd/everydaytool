// 应用壳 命令通道（前后端共享的唯一事实来源）。
// 命令通道以 shared/command-groups/ 为准，Rust 侧按域注册 commands。
export const APP_COMMANDS = {
  DATA_DIRECTORY_GET: 'edt-app:data-directory:get',
  DATA_DIRECTORY_SELECT: 'edt-app:data-directory:select',
  DATA_DIRECTORY_UPDATE: 'edt-app:data-directory:update',
  DATA_DIRECTORY_OPEN: 'edt-app:data-directory:open',
  DATA_USAGE_GET: 'edt-app:data-usage:get',
  CACHE_CLEAR: 'edt-app:cache:clear',
  // 设置页的「打开调试控制台」：为调用方窗口打开独立 DevTools 窗口
  DEVTOOLS_OPEN: 'edt-app:devtools:open',
  // 主进程 → 渲染层推送：窗口进/出全屏（EVENT_ 开头，前端 on() 白名单要求）
  EVENT_FULLSCREEN_CHANGED: 'edt-app:event:fullscreen-changed',
  // 窗口外观（半透明 / 系统材质）：跨进程生效，主进程推送最新值保持渲染层同步
  APPEARANCE_GET: 'edt-app:appearance:get',
  APPEARANCE_SET: 'edt-app:appearance:set',
  EVENT_APPEARANCE_CHANGED: 'edt-app:event:appearance-changed',
} as const

export type AppCommand = (typeof APP_COMMANDS)[keyof typeof APP_COMMANDS]
