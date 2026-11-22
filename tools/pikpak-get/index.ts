import { defineTool } from '../../renderer/shared/tool/defineTool'

export default defineTool({
  id: 'pikpak-get',
  name: 'PikPak 下载',
  description: '连接 NAS 或本机引擎，维护账号池与分享链接，勾选文件后下载',
  version: '1.0.0',
  icon: 'download',
  category: { key: 'general', name: '通用工具' },
  keywords: ['pikpak', 'pikpakget', '下载', '网盘', 'nas', '分享'],
  supportedTargets: ['win', 'mac'],
  createdAt: '2026-11-22',
  route: {
    path: 'pikpak-get',
    name: 'tool-pikpak-get',
    component: () => import('./renderer/pages/PikpakGetPage.vue'),
    meta: { toolId: 'pikpak-get', title: 'PikPak 下载' },
  },
})
