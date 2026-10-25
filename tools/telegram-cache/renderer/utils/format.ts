// 展示层格式化：只做纯计算，不碰 IPC / DOM。

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—'
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unit]}`
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

export function formatClock(timestamp?: number): string {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

export function formatDateTime(timestamp?: number): string {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`
}

/** 页面地址只展示 origin + pathname：query / hash 可能带登录或消息定位凭据，不进 UI */
export function sanitizePageUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    return `${url.origin}${url.pathname}`
  } catch {
    return rawUrl ? '（无法解析的页面地址）' : ''
  }
}

export function shortenMiddle(value: string, max = 64): string {
  if (!value || value.length <= max) return value
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`
}
