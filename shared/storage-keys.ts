// 前端 localStorage / 会话持久化键的单一来源：散落的魔法字符串容易在重构时改漏，
// 集中后重命名、迁移和清理都只动这一处。
export const STORAGE_KEYS = {
  favoriteTools: 'edt:favorite-tools',
  toolTabs: 'edt:tool-tabs',
  envBrowserConfigs: 'edt:env-browser:configs',
  treeaseInterceptRules: 'edt:treease-intercept-rules',
  treeaseInterceptEnabled: 'edt:treease-intercept-enabled',
} as const
