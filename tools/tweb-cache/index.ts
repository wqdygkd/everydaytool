import { defineTool } from '../../renderer/shared/tool/defineTool'

const tool = defineTool({
  id: 'tweb-cache',
  name: 'Telegram 缓存（tweb）',
  description: '以 tweb（Telegram Web K）为前端的本地归档：右键把消息与媒体写进本工具自己的影库，支持断点续传、离线播放与消息定位',
  version: '1.0.0',
  icon: 'telegram',
  category: { key: 'browser', name: '浏览器工具' },
  keywords: ['telegram', 'tweb', 'webk', '缓存', '归档', '影库', '离线播放', '下载'],
  supportedTargets: ['web', 'win', 'mac'],
  createdAt: '2026-10-30',
  route: {
    path: 'tweb-cache',
    name: 'tool-tweb-cache',
    component: () => import('./renderer/pages/TwebCachePage.vue'),
    meta: { toolId: 'tweb-cache', title: 'Telegram 缓存（tweb）' },
  },
  // 子路由只驱动右侧面板，webview 常驻（与 telegram-cache 同构）
  subRoutes: [
    { path: 'overview', name: 'tool-tweb-cache-overview', meta: { title: '概览' } },
    { path: 'library', name: 'tool-tweb-cache-library', meta: { title: '影库' } },
  ],
})

export default tool
