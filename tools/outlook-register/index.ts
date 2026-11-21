import { defineTool } from '../../renderer/shared/tool/defineTool'

export default defineTool({
  id: 'outlook-register',
  name: 'Outlook 注册',
  description: '生成 Outlook 注册资料（软件内不加载注册页），注册后直接打开邮箱收信',
  version: '1.0.0',
  icon: 'outlook',
  category: { key: 'general', name: '通用工具' },
  keywords: ['outlook', 'hotmail', '邮箱', '注册', 'mail'],
  supportedTargets: ['win', 'mac'],
  createdAt: '2026-11-21',
  subRoutes: [
    { path: 'register', name: 'tool-outlook-register-register', meta: { title: 'Outlook 注册资料' } },
    { path: 'mailbox', name: 'tool-outlook-register-mailbox', meta: { title: 'Outlook 邮箱' } },
  ],
  route: {
    path: 'outlook-register',
    name: 'tool-outlook-register',
    component: () => import('./renderer/pages/OutlookRegisterPage.vue'),
    meta: { toolId: 'outlook-register', title: 'Outlook 注册' },
  },
})
