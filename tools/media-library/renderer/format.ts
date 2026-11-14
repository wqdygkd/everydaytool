// 媒体库的展示文案 / 数值格式化（纯函数）。
import type { CollectionKind, CollectionSummary, ScanStats } from '@shared/media-library'

export const KIND: Record<CollectionKind, { label: string, icon: 'film' | 'image' | 'layers' }> = {
  video: { label: '视频', icon: 'film' },
  image: { label: '图集', icon: 'image' },
  mixed: { label: '混合', icon: 'layers' },
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB'
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / 1024 ** 2
  if (mb >= 1) return `${Math.round(mb)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** 播放时间：不足一小时 `m:ss`，否则 `h:mm:ss` */
export function formatTime(seconds: number | undefined): string {
  const total = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`
}

export function formatAgo(iso: string | undefined): string {
  if (!iso) return '—'
  const at = new Date(iso).getTime()
  if (Number.isNaN(at)) return '—'
  const diff = Date.now() - at
  const minute = 60_000
  if (diff < minute) return '刚刚'
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`
  const days = Math.floor(diff / (24 * 60 * minute))
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  const date = new Date(at)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return sameYear ? `${date.getMonth() + 1} 月 ${date.getDate()} 日` : `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function countLabel(c: Pick<CollectionSummary, 'kind' | 'videos' | 'images'>): string {
  if (c.kind === 'video') return c.videos > 1 ? `${c.videos} 集` : '单条'
  if (c.kind === 'image') return `${c.images} 张`
  return `${c.videos} + ${c.images}`
}

export function displayArtist(c: Pick<CollectionSummary, 'artists'>): string {
  return c.artists.length ? c.artists.join('、') : '未指定艺人'
}

/** 卡片说明行：艺人 · 年份 · 大小（年份为空时省略） */
export function captionLine(c: CollectionSummary): string {
  return [displayArtist(c), c.year, formatBytes(c.bytes)].filter(Boolean).join(' · ')
}

/** 封面区说明行：艺人 · 年份 · N 部视频 · N 张图片 · 大小 */
export function heroMetaLine(c: CollectionSummary): string {
  const parts = [displayArtist(c), c.year]
  if (c.videos) parts.push(`${c.videos} 部视频`)
  if (c.images) parts.push(`${c.images} 张图片`)
  parts.push(formatBytes(c.bytes))
  return parts.filter(Boolean).join(' · ')
}

export function mediaCountLine(videos: number, images: number): string {
  const parts: string[] = []
  if (videos) parts.push(`${videos} 视频`)
  if (images) parts.push(`${images} 图片`)
  return parts.join(' · ') || '无媒体'
}

export function scanCountsLabel(stats: ScanStats): string {
  const parts: string[] = []
  if (stats.videos) parts.push(`${stats.videos} 视频`)
  if (stats.images) parts.push(`${stats.images} 图片`)
  if (!parts.length) parts.push(stats.other ? `${stats.other} 个其他文件` : '无媒体')
  return parts.join(' · ')
}

export function artistInitials(name: string): string {
  return /[A-Z]/i.test(name) ? name.replace(/\s+/g, '').slice(0, 2).toUpperCase() : name.slice(0, 1)
}

export function seriesDateLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '刚刚更新'
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日更新`
}

export function searchHaystack(c: CollectionSummary): string {
  return [c.title, c.description, c.rootPath, ...c.artists, ...c.tags].join(' ').toLowerCase()
}
