import { defineTool } from '../../renderer/shared/tool/defineTool'

const tool = defineTool({
  id: 'telegram-cache',
  name: 'Telegram 网络优化',
  description: '内嵌 Telegram Web：把消息与媒体归档到本地（群 id / 消息 id 目录、媒体键命名），支持断点续传、离线播放、影库检索与回收站',
  version: '1.8.0',
  icon: 'telegram',
  category: { key: 'browser', name: '浏览器工具' },
  keywords: ['telegram', 'tg', 'telegram web', '缓存', '归档', '影库', '离线播放', '下载', 'mtproto', '诊断'],
  supportedTargets: ['web', 'win', 'mac'],
  createdAt: '2026-10-25',
  route: {
    path: 'telegram-cache',
    name: 'tool-telegram-cache',
    component: () => import('./renderer/pages/TelegramCachePage.vue'),
    meta: { toolId: 'telegram-cache', title: 'Telegram 网络优化' },
  },
  // 子路由只驱动右侧面板（概览 / 进度 / 诊断 / 影库），webview 始终常驻，切视图不会重载页面
  subRoutes: [
    { path: 'overview', name: 'tool-telegram-cache-overview', meta: { title: '概览' } },
    { path: 'tasks', name: 'tool-telegram-cache-tasks', meta: { title: '进度' } },
    { path: 'diagnostics', name: 'tool-telegram-cache-diagnostics', meta: { title: '诊断' } },
    { path: 'library', name: 'tool-telegram-cache-library', meta: { title: '影库' } },
  ],
})

export default tool
