import { defineTool } from '../../renderer/shared/tool/defineTool'

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
    // 工具页按需加载：不进主包，进入工具时才拉对应 chunk
    component: () => import('./renderer/pages/ChromeSandbox.vue'),
    meta: { toolId: 'chrome-sandbox', title: 'Chrome沙箱' },
  },
})

export default tool
