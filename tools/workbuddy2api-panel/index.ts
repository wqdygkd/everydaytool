import { defineTool } from '../../src/shared/tool/defineTool'

const tool = defineTool({
  id: 'workbuddy2api-panel',
  name: 'WorkBuddy2API',
  description: '托管 workbuddy2api-panel：左栏面板，右栏安装 / 启停 / 更新（二进制不进安装包）',
  version: '1.0.0',
  color: '#3390ec',
  icon: 'wb2api',
  category: { key: 'dev', name: '开发工具' },
  keywords: ['workbuddy', 'wb2api', 'workbuddy2api', 'panel', 'api', 'gateway'],
  supportedTargets: ['win', 'mac'],
  createdAt: '2026-10-26',
  route: {
    path: 'workbuddy2api-panel',
    name: 'tool-workbuddy2api-panel',
    component: () => import('./pages/Workbuddy2apiPanelPage.vue'),
    meta: { toolId: 'workbuddy2api-panel', title: 'WorkBuddy2API' },
  },
})

export default tool
