import { defineComponent, h } from 'vue'
import { defineTool } from '../../renderer/shared/tool/defineTool'

// 实现已清空，重构完成前只保留工具定义与占位页。
const PlaceholderPage = defineComponent({
  name: 'TreeaseEditorPlaceholder',
  setup: () => () => h('div', { style: 'padding: var(--spacing-xl); color: var(--text-muted)' }, 'Treease 编辑器重构中'),
})

const tool = defineTool({
  id: 'treease-editor',
  name: 'Treease 编辑器',
  description: '在线树形结构编辑器（treease.com/editor）',
  version: '1.2.0',
  icon: 'treease',
  category: { key: 'dev', name: '开发工具' },
  keywords: ['treease', 'editor', 'tree', '树形', '编辑器', 'json'],
  supportedTargets: ['web', 'win', 'mac'],
  createdAt: '2026-09-22',
  route: {
    path: 'treease-editor',
    name: 'tool-treease-editor',
    component: PlaceholderPage,
    meta: { toolId: 'treease-editor', title: 'Treease 编辑器' },
  },
})

export default tool
