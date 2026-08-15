import type { ToolDefinition } from '../../renderer/shared/types/tool.js';
import CdpInjectorPage from './renderer/pages/CdpInjector.vue';

const tool: ToolDefinition = {
  id: 'cdp-injector',
  name: 'CDP 脚本注入',
  description: '批量启动应用并通过调试端口注入自定义脚本',
  version: '1.0.0',
  color: '#10b981',
  supportedTargets: ['win', 'mac'],
  route: {
    path: 'cdp-injector',
    name: 'tool-cdp-injector',
    component: CdpInjectorPage,
    meta: { toolId: 'cdp-injector' },
  },
};

export default tool;
