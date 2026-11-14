// 媒体库的子路由映射：竖脊页签 + 详情 / 艺人主页 / 系列详情三个带参数的深链。
// 路由拍平为 `/tools/media-library/<path>`，见 renderer/router/routes.ts。

export type MediaLibraryView = 'library' | 'collection' | 'series' | 'inbox' | 'tags' | 'artists' | 'sources'

export const MEDIA_LIBRARY_BASE = '/tools/media-library'

/** 竖脊上的六个入口（顺序即显示顺序）；`divided` 表示它前面画一条分隔线 */
export const MEDIA_LIBRARY_TABS: Array<{ key: MediaLibraryView, label: string, divided?: boolean }> = [
  { key: 'library', label: '资料库' },
  { key: 'series', label: '系列' },
  { key: 'inbox', label: '待整理' },
  { key: 'tags', label: '标签', divided: true },
  { key: 'artists', label: '艺人' },
  { key: 'sources', label: '来源' },
]

/** 子路由声明：第一个是工具根路径的重定向目标 */
export const MEDIA_LIBRARY_SUB_ROUTES: Array<{ path: string, name: string, title: string }> = [
  { path: 'library', name: 'tool-media-library-library', title: '资料库' },
  { path: 'collection/:collectionId', name: 'tool-media-library-collection', title: '合集' },
  { path: 'series', name: 'tool-media-library-series', title: '系列' },
  { path: 'series/:seriesId', name: 'tool-media-library-series-detail', title: '系列' },
  { path: 'inbox', name: 'tool-media-library-inbox', title: '待整理' },
  { path: 'tags', name: 'tool-media-library-tags', title: '标签' },
  { path: 'artists', name: 'tool-media-library-artists', title: '艺人' },
  { path: 'artists/:artistId', name: 'tool-media-library-artist', title: '艺人' },
  { path: 'sources', name: 'tool-media-library-sources', title: '来源' },
]

export interface ParsedMediaLibraryPath {
  view: MediaLibraryView
  /** 合集 / 艺人 / 系列 id；列表页为 null */
  id: string | null
}

const VIEWS = new Set<string>(['library', 'collection', 'series', 'inbox', 'tags', 'artists', 'sources'])

export function parseMediaLibraryPath(path: string): ParsedMediaLibraryPath {
  const rest = path.startsWith(MEDIA_LIBRARY_BASE) ? path.slice(MEDIA_LIBRARY_BASE.length) : ''
  const [first, second] = rest.split('/').filter(Boolean)
  const view = (first && VIEWS.has(first) ? first : 'library') as MediaLibraryView
  let id: string | null = null
  if (second) {
    try {
      id = decodeURIComponent(second)
    } catch {
      id = second
    }
  }
  if (view === 'collection' && !id) return { view: 'library', id: null }
  return { view, id }
}

/** 竖脊高亮：合集详情归在「资料库」下 */
export function spineKeyOf(view: MediaLibraryView): MediaLibraryView {
  return view === 'collection' ? 'library' : view
}
