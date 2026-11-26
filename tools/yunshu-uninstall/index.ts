import { defineTool } from '../../renderer/shared/tool/defineTool'

const tool = defineTool({
  id: 'yunshu-uninstall',
  name: '云枢卸载',
  description: '扫描并移除云枢 / eagleyun SASE 客户端的残留：服务、进程、文件与根证书',
  version: '1.0.0',
  icon: 'trash',
  category: { key: 'system', name: '系统工具' },
  keywords: ['yunshu', '云枢', 'eagleyun', 'sase', 'uninstall', '卸载', '残留', '清理', '证书'],
  supportedTargets: ['win', 'mac'],
  createdAt: '2026-11-26',
  route: {
    path: 'yunshu-uninstall',
    name: 'tool-yunshu-uninstall',
    component: () => import('./renderer/pages/YunshuUninstallPage.vue'),
    meta: { toolId: 'yunshu-uninstall', title: '云枢卸载' },
  },
})

export default tool
