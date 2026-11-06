export const SKILL_MANAGER_TABS = [
  { key: 'installed', label: '技能库', routeName: 'tool-skill-manager-installed' },
  { key: 'updates', label: '更新', routeName: 'tool-skill-manager-updates' },
  { key: 'favorites', label: '收藏', routeName: 'tool-skill-manager-favorites' },
  { key: 'presets', label: '预设', routeName: 'tool-skill-manager-presets' },
  { key: 'projects', label: '项目', routeName: 'tool-skill-manager-projects' },
] as const

export type SkillManagerTabKey = (typeof SKILL_MANAGER_TABS)[number]['key']

export function tabKeyFromPath(path: string): SkillManagerTabKey {
  const tail = path.split('/').filter(Boolean).at(-1)
  const tab = SKILL_MANAGER_TABS.find(item => item.key === tail)
  return tab?.key ?? 'installed'
}
