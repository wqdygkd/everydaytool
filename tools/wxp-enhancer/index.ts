import { defineTool } from '../../src/shared/tool/defineTool'

const tool = defineTool({
  id: 'wxp-enhancer',
  name: 'WXP 增强',
  description: '通过 CDP 启动 WXP：缓存登录会话、备份与恢复转发收藏，并注入增强角标',
  version: '1.0.0',
  color: '#46ba43',
  icon: 'wxpEnhancer',
  category: { key: 'automation', name: '自动化工具' },
  keywords: ['wxp', 'cdp', '注入', '增强', '登录', '登录缓存', '收藏', '角标', '界面'],
  supportedTargets: ['win', 'mac'],
  createdAt: '2026-10-05',
  route: {
    path: 'wxp-enhancer',
    name: 'tool-wxp-enhancer',
    component: () => import('./pages/WxpEnhancer.vue'),
    meta: { toolId: 'wxp-enhancer', title: 'WXP 增强' },
  },
})

export default tool
