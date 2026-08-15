import { defineTool } from '../../renderer/shared/tool/defineTool.js';
import CdpInjectorPage from './renderer/pages/CdpInjector.vue';

const tool = defineTool({
  id: 'cdp-injector',
  name: 'CDP 脚本注入',
  description: '批量启动应用并通过调试端口注入自定义脚本',
  version: '1.0.0',
  color: '#10b981',
  category: { key: 'automation', name: '自动化工具' },
  keywords: ['cdp', 'devtools', 'inject', 'script', 'automation', '注入', '脚本'],
  supportedTargets: ['win', 'mac'],
  createdAt: '2026-08-15',
  route: {
    path: 'cdp-injector',
    component: CdpInjectorPage,
  },
});

export default tool;
