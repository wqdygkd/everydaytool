import { defineTool } from '../../renderer/shared/tool/defineTool'
import EnvBrowserPage from './renderer/pages/EnvBrowserPage.vue'

const tool = defineTool({
  id: 'env-browser',
  name: '环境浏览器',
  description: '多环境独立登录、应用内沙箱、Tab 多开',
  version: '1.0.0',
  color: '#10b981',
  category: { key: 'browser', name: '浏览器工具' },
  keywords: ['env', 'browser', 'login', '环境', '多开', '沙箱', 'tab'],
  supportedTargets: ['web', 'win', 'mac'],
  createdAt: '2026-09-22',
  route: {
    path: 'env-browser',
    name: 'tool-env-browser',
    component: EnvBrowserPage,
    meta: { toolId: 'env-browser', title: '环境浏览器' },
  },
})

export default tool
