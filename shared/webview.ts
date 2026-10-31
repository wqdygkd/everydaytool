// treease-editor 内嵌 webview 的 session 分区：前端 webview 标签与后端协议层 handler 共用，单一事实来源。
// 后端在 initialize 时即按此分区预装协议层 handler，保证首次导航就被接管
// （页面缓存与拦截都不依赖 dom-ready 时机）。
export const TREEASE_WEBVIEW_PARTITION = 'persist:treease-editor'

// telegram-cache 内嵌 Telegram Web A 的 session 分区：工具页 webview 与后端 webRequest
// 观测 / session.fetch 共用同一个分区，保证「观测到的请求」「页面登录态」「下载请求」
// 落在同一个 cookie / 代理上下文里。分区名带 persist: 前缀，登录态可跨重启保留。
export const TELEGRAM_WEBVIEW_PARTITION = 'persist:telegram-cache'

// workbuddy2api-panel 内嵌上游 /panel/ 的 session 分区：与宿主页隔离，保留面板登录态。
export const WB2API_WEBVIEW_PARTITION = 'persist:workbuddy2api-panel'

// tweb-cache 内嵌 tweb（Telegram Web K）的 session 分区：与 telegram-cache 的分区**分开**，
// 两个客户端的登录态、IndexedDB、Cache Storage 互不干扰（各自站点端口也不同）。
export const TWEB_CACHE_WEBVIEW_PARTITION = 'persist:tweb-cache'
