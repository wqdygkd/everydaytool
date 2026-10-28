import { defineTool } from '../../src/shared/tool/defineTool'

const tool = defineTool({
  id: 'telegram-cache',
  name: 'Telegram 网络优化',
  description: '内嵌 Telegram Web A：观测资源、按 HTTP 语义缓存与归档、MTProto 消息媒体下载',
  version: '1.0.0',
  color: '#2aabee',
  icon: 'telegram',
  category: { key: 'browser', name: '浏览器工具' },
  keywords: ['telegram', 'tg', 'telegram web', '网络', '缓存', '观测', '资源', '去重', 'mtproto', '诊断', 'lru'],
  supportedTargets: ['win', 'mac'],
  createdAt: '2026-10-25',
  route: {
    path: 'telegram-cache',
    name: 'tool-telegram-cache',
    component: () => import('./pages/TelegramCachePage.vue'),
    meta: { toolId: 'telegram-cache', title: 'Telegram 网络优化' },
  },
  // 子路由只驱动右侧面板（概览 / 资源 / 任务 / 诊断），webview 始终常驻，切视图不会重载页面
  subRoutes: [
    { path: 'overview', name: 'tool-telegram-cache-overview', meta: { title: '概览' } },
    { path: 'resources', name: 'tool-telegram-cache-resources', meta: { title: '资源' } },
    { path: 'tasks', name: 'tool-telegram-cache-tasks', meta: { title: '任务' } },
    { path: 'diagnostics', name: 'tool-telegram-cache-diagnostics', meta: { title: '诊断' } },
  ],
})

export default tool
