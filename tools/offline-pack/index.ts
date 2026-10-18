import { defineTool } from '../../renderer/shared/tool/defineTool'
import { OFFLINE_PACK_TABS } from './renderer/tabs'

const tool = defineTool({
  id: 'offline-pack',
  name: '离线包下载',
  description: '一站式下载 VSCode 插件、Chrome/Edge 扩展、Docker 镜像、Microsoft Store 应用离线安装包',
  version: '1.0.0',
  color: '#3390ec',
  icon: 'offline-pack',
  category: { key: 'dev', name: '开发工具' },
  keywords: ['offline-pack', 'offlinepack', '离线', '下载', 'vscode', 'chrome', 'edge', 'docker', 'msstore', '离线包'],
  supportedTargets: ['win', 'mac'],
  createdAt: '2026-10-18',
  route: {
    path: 'offline-pack',
    name: 'tool-offline-pack',
    component: () => import('./renderer/pages/OfflinePackPage.vue'),
    meta: { toolId: 'offline-pack', title: '离线包下载' },
  },
  // 每个下载器一个页签路由（深链 / 前进后退）；主路由经 routes.ts 重定向到第一个子路由（vscode）
  subRoutes: OFFLINE_PACK_TABS.map(tab => ({
    path: tab.key,
    name: tab.routeName,
    meta: { title: `离线包下载 · ${tab.label}` },
  })),
})

export default tool
