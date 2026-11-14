import { defineTool } from '../../renderer/shared/tool/defineTool'
import { MEDIA_LIBRARY_SUB_ROUTES } from './renderer/tabs'

// 媒体库依赖主进程读本地目录、生成缩略图并提供回环媒体服务，网页预览下没有这些能力，
// 所以不声明 web 目标。
const tool = defineTool({
  id: 'media-library',
  name: '媒体库',
  description: '本地影片与套图的只读索引；元信息保存在 edt 中',
  version: '1.0.0',
  icon: 'film',
  category: { key: 'media', name: '媒体工具' },
  keywords: ['media-library', '媒体库', '影片', '视频', '套图', '图集', '相册', '艺人', '系列', 'video', 'gallery'],
  supportedTargets: ['win', 'mac', 'linux'],
  createdAt: '2026-11-14',
  route: {
    path: 'media-library',
    name: 'tool-media-library',
    component: () => import('./renderer/pages/MediaLibraryPage.vue'),
    meta: { toolId: 'media-library', title: '媒体库' },
  },
  subRoutes: MEDIA_LIBRARY_SUB_ROUTES.map(sub => ({
    path: sub.path,
    name: sub.name,
    meta: { title: `媒体库 · ${sub.title}` },
  })),
})

export default tool
