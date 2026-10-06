import { defineTool } from '../../renderer/shared/tool/defineTool'
import ChromeSandboxPage from './renderer/pages/ChromeSandbox.vue'

const tool = defineTool({
  id: 'chrome-sandbox',
  name: 'Chrome沙箱',
  description: '多沙箱浏览器管理',
  version: '1.0.0',
  color: '#408acf',
  category: { key: 'browser', name: '浏览器工具' },
  keywords: ['chrome', 'sandbox', 'browser', 'profile', '指纹', '沙箱'],
  supportedTargets: ['win', 'mac'],
  createdAt: '2026-05-23',
  route: {
    path: 'chrome-sandbox',
    name: 'tool-chrome-sandbox',
    component: ChromeSandboxPage,
    meta: { toolId: 'chrome-sandbox', title: 'Chrome沙箱' },
  },
})

export default tool
