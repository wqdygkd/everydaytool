// edt 平台级（应用壳）IPC 通道：数据根目录管理、磁盘用量、缓存清理。
// 与工具域通道（tools/*/backend/ipc/channels.ts）平行，经 preload 命名空间 edtApp 暴露。
export const EDT_APP_IPC_CHANNELS = {
  DATA_DIRECTORY_GET: 'edt-app:data-directory:get',
  DATA_DIRECTORY_SELECT: 'edt-app:data-directory:select',
  DATA_DIRECTORY_UPDATE: 'edt-app:data-directory:update',
  DATA_DIRECTORY_OPEN: 'edt-app:data-directory:open',
  DATA_USAGE_GET: 'edt-app:data-usage:get',
  CACHE_CLEAR: 'edt-app:cache:clear',
  // 主进程 → 渲染层推送：窗口进/出全屏（EVENT_ 开头，preload on() 白名单要求）
  EVENT_FULLSCREEN_CHANGED: 'edt-app:event:fullscreen-changed',
  // 窗口外观（半透明 / 系统材质）：跨进程生效，主进程推送最新值保持渲染层同步
  APPEARANCE_GET: 'edt-app:appearance:get',
  APPEARANCE_SET: 'edt-app:appearance:set',
  // 主进程 → 渲染层推送：外观已变更（含平台降级后的最终值）
  EVENT_APPEARANCE_CHANGED: 'edt-app:event:appearance-changed',
} as const

export type EdtAppIpcChannel = (typeof EDT_APP_IPC_CHANNELS)[keyof typeof EDT_APP_IPC_CHANNELS]
