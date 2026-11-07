// treease-editor 内嵌 webview 的 session 分区：前端 webview 标签与后端协议层 handler 共用，单一事实来源。
// 后端在 initialize 时即按此分区预装协议层 handler，保证首次导航就被接管
// （页面缓存与拦截都不依赖 dom-ready 时机）。
export const TREEASE_WEBVIEW_PARTITION = 'persist:treease-editor'

// workbuddy2api-panel 内嵌上游 /panel/ 的 session 分区：与宿主页隔离，保留面板登录态。
export const WB2API_WEBVIEW_PARTITION = 'persist:workbuddy2api-panel'

// tweb-cache 内嵌 tweb（Telegram Web K）的 session 分区：登录态、IndexedDB、
// Cache Storage 都按 origin 与分区隔离。分区名带 persist: 前缀，登录态可跨重启保留。
export const TWEB_CACHE_WEBVIEW_PARTITION = 'persist:tweb-cache'
