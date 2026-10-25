// treease-editor 内嵌 webview 的 session 分区：前端 webview 标签与后端协议层 handler 共用，单一事实来源。
// 后端在 initialize 时即按此分区预装协议层 handler，保证首次导航就被接管
// （页面缓存与拦截都不依赖 dom-ready 时机）。
export const TREEASE_WEBVIEW_PARTITION = 'persist:treease-editor'

// telegram-cache 内嵌 Telegram Web A 的 session 分区：工具页 webview 与后端 webRequest
// 观测 / session.fetch 共用同一个分区，保证「观测到的请求」「页面登录态」「下载请求」
// 落在同一个 cookie / 代理上下文里。分区名带 persist: 前缀，登录态可跨重启保留。
export const TELEGRAM_WEBVIEW_PARTITION = 'persist:telegram-cache'
