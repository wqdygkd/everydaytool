import { defineTool } from '../../renderer/shared/tool/defineTool'
import { SKILL_MANAGER_TABS } from './renderer/tabs'

const tool = defineTool({
  id: 'skill-manager',
  name: '技能管理',
  description: '按仓库对账、更新、禁用与收藏本机与项目技能，并管理 skills-lock.json',
  version: '1.0.0',
  icon: 'layers',
  category: { key: 'dev', name: '开发工具' },
  keywords: ['skill', 'skills', '技能', '技能管理', 'agents', 'skills-lock', 'lock'],
  supportedTargets: ['web', 'win', 'mac'],
  createdAt: '2026-11-06',
  route: {
    path: 'skill-manager',
    name: 'tool-skill-manager',
    component: () => import('./renderer/pages/SkillManagerPage.vue'),
    meta: { toolId: 'skill-manager', title: '技能管理' },
  },
  subRoutes: SKILL_MANAGER_TABS.map(tab => ({
    path: tab.key,
    name: tab.routeName,
    meta: { title: `技能管理 · ${tab.label}` },
  })),
})

export default tool
