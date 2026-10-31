// tweb-cache 视图 / 路由映射（与 telegram-cache 同构：面板切换由子路由驱动，可深链）。
export type TwebCacheTabKey = 'overview' | 'library'

export interface TwebCacheTabDef {
  key: TwebCacheTabKey
  label: string
  routeName: string
}

export const TWEB_CACHE_TOOL_ROOT = '/tools/tweb-cache'

export const TWEB_CACHE_TABS: readonly TwebCacheTabDef[] = [
  { key: 'overview', label: '概览', routeName: 'tool-tweb-cache-overview' },
  { key: 'library', label: '影库', routeName: 'tool-tweb-cache-library' },
]

/** 从路由 path 解析当前面板；非法 / 缺失回落概览 */
export function tabKeyFromPath(path: string): TwebCacheTabKey {
  const prefix = `${TWEB_CACHE_TOOL_ROOT}/`
  const segment = path.startsWith(prefix) ? path.slice(prefix.length).split('/')[0] : ''
  return TWEB_CACHE_TABS.find(tab => tab.key === segment)?.key ?? 'overview'
}
