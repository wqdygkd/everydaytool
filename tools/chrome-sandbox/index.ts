import type { ToolDefinition } from '../../renderer/shared/types/tool.js';
import ChromeSandboxPage from './renderer/pages/ChromeSandbox.vue';

const tool: ToolDefinition = {
  id: 'chrome-sandbox',
  name: 'Chrome沙箱',
  description: '多沙箱浏览器管理',
  version: '1.0.0',
  color: '#3b82f6',
  route: {
    path: 'chrome-sandbox',
    name: 'tool-chrome-sandbox',
    component: ChromeSandboxPage,
    meta: { toolId: 'chrome-sandbox' },
  },
};

export default tool;
