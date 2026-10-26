// edt 平台级（应用壳）IPC 通道：数据根目录管理、磁盘用量、缓存清理、调试工具。
// 与工具域通道（tools/*/backend/ipc/channels.ts）平行，经 preload 命名空间 edtApp 暴露。
export const EDT_APP_IPC_CHANNELS = {
  DATA_DIRECTORY_GET: 'edt-app:data-directory:get',
  DATA_DIRECTORY_SELECT: 'edt-app:data-directory:select',
  DATA_DIRECTORY_UPDATE: 'edt-app:data-directory:update',
  DATA_DIRECTORY_OPEN: 'edt-app:data-directory:open',
  DATA_USAGE_GET: 'edt-app:data-usage:get',
  CACHE_CLEAR: 'edt-app:cache:clear',
  // 设置页的「打开调试控制台」：主进程为调用方窗口打开独立 DevTools 窗口
  DEVTOOLS_OPEN: 'edt-app:devtools:open',
  // 主进程 → 渲染层推送：窗口进/出全屏（EVENT_ 开头，preload on() 白名单要求）
  EVENT_FULLSCREEN_CHANGED: 'edt-app:event:fullscreen-changed',
  // 窗口外观（半透明 / 系统材质）：跨进程生效，主进程推送最新值保持渲染层同步
  APPEARANCE_GET: 'edt-app:appearance:get',
  APPEARANCE_SET: 'edt-app:appearance:set',
  // 主进程 → 渲染层推送：外观已变更（含平台降级后的最终值）
  EVENT_APPEARANCE_CHANGED: 'edt-app:event:appearance-changed',
  // 窗口大小 / 位置：读取当前记录、开关「记住窗口大小与位置」、重置回默认尺寸居中
  WINDOW_BOUNDS_GET: 'edt-app:window-bounds:get',
  WINDOW_BOUNDS_SET: 'edt-app:window-bounds:set',
  WINDOW_BOUNDS_RESET: 'edt-app:window-bounds:reset',
  // 外部链接：window.open 已由主进程 deny，渲染层统一经此通道交给系统浏览器打开
  // （主进程校验协议与调用方来源，见 electron/main.ts）
  OPEN_EXTERNAL: 'edt-app:open-external',
} as const

export type EdtAppIpcChannel = (typeof EDT_APP_IPC_CHANNELS)[keyof typeof EDT_APP_IPC_CHANNELS]
