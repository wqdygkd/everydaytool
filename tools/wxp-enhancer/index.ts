import { defineTool } from '../../renderer/shared/tool/defineTool'
import WxpEnhancerPage from './renderer/pages/WxpEnhancer.vue'

const tool = defineTool({
  id: 'wxp-enhancer',
  name: 'WXP 增强',
  description: '通过 CDP 启动 WXP，缓存登录状态并注入 CSS/JS 自定义界面',
  version: '1.0.0',
  color: '#07c160',
  category: { key: 'automation', name: '自动化工具' },
  keywords: ['wxp', 'cdp', 'inject', 'css', 'js', '界面', '注入', '增强', '登录'],
  supportedTargets: ['win', 'mac'],
  createdAt: '2026-10-05',
  route: {
    path: 'wxp-enhancer',
    name: 'tool-wxp-enhancer',
    component: WxpEnhancerPage,
    meta: { toolId: 'wxp-enhancer', title: 'WXP 增强' },
  },
})

export default tool
