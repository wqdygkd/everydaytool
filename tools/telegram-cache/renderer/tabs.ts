// telegram-cache 视图 / 路由映射：右侧面板的切换状态由子路由驱动（URL 可深链、前进后退可用），
// 与 interceptor 的 tabs.ts 同构，避免页面、面板、注册表三处各写一份路径。
export type TelegramCacheTabKey = 'overview' | 'resources' | 'tasks' | 'diagnostics'

export interface TelegramCacheTabDef {
  key: TelegramCacheTabKey
  label: string
  routeName: string
}

export const TELEGRAM_CACHE_TOOL_ROOT = '/tools/telegram-cache'

export const TELEGRAM_CACHE_TABS: readonly TelegramCacheTabDef[] = [
  { key: 'overview', label: '概览', routeName: 'tool-telegram-cache-overview' },
  { key: 'resources', label: '资源', routeName: 'tool-telegram-cache-resources' },
  { key: 'tasks', label: '任务', routeName: 'tool-telegram-cache-tasks' },
  { key: 'diagnostics', label: '诊断', routeName: 'tool-telegram-cache-diagnostics' },
]

/** 从路由 path 解析当前面板；非法 / 缺失回落概览 */
export function tabKeyFromPath(path: string): TelegramCacheTabKey {
  const prefix = `${TELEGRAM_CACHE_TOOL_ROOT}/`
  const segment = path.startsWith(prefix) ? path.slice(prefix.length).split('/')[0] : ''
  return TELEGRAM_CACHE_TABS.find(tab => tab.key === segment)?.key ?? 'overview'
}
