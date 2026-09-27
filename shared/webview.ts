// treease-editor 内嵌 webview 的 session 分区：前端 webview 标签与后端协议层 handler 共用，单一事实来源。
// 后端在 initialize 时即按此分区预装协议层 handler，保证首次导航就被接管
// （页面缓存与拦截都不依赖 dom-ready 时机）。
export const TREEASE_WEBVIEW_PARTITION = 'persist:treease-editor'
