import { defineTool } from '../../renderer/shared/tool/defineTool'
import TreeaseEditorPage from './renderer/pages/TreeaseEditorPage.vue'

const tool = defineTool({
  id: 'treease-editor',
  name: 'Treease 编辑器',
  description: '在线树形结构编辑器（treease.com/editor）',
  version: '1.0.0',
  color: '#8b5cf6',
  category: { key: 'dev', name: '开发工具' },
  keywords: ['treease', 'editor', 'tree', '树形', '编辑器', 'json'],
  supportedTargets: ['web', 'win', 'mac'],
  createdAt: '2026-09-22',
  route: {
    path: 'treease-editor',
    name: 'tool-treease-editor',
    component: TreeaseEditorPage,
    meta: { toolId: 'treease-editor', title: 'Treease 编辑器' },
  },
})

export default tool
