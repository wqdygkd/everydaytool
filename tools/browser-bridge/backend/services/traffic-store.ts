// 流量日志（v1：内存环形缓冲，不落库；请求/响应体按 TRAFFIC_BODY_MAX_CHARS 截断）。
// 渲染层经 IPC 事件增量订阅；处理名单的"相关域名提示"也从这里回捞。
import type { TrafficEntry } from '../../../../shared/browser-bridge.ts'
import { TRAFFIC_RING_SIZE } from '../../../../shared/browser-bridge.ts'

const entries: TrafficEntry[] = []
const subscribers = new Set<(entry: TrafficEntry) => void>()

export function addTrafficEntry(entry: TrafficEntry): void {
  entries.push(entry)
  if (entries.length > TRAFFIC_RING_SIZE) {
    entries.splice(0, entries.length - TRAFFIC_RING_SIZE)
  }
  for (const subscriber of subscribers) {
    try {
      subscriber(entry)
    } catch {
      // 单个订阅方异常不影响其余
    }
  }
}

export function listTrafficEntries(): TrafficEntry[] {
  return [...entries]
}

export function clearTrafficEntries(): void {
  entries.length = 0
}

export function subscribeTraffic(subscriber: (entry: TrafficEntry) => void): () => void {
  subscribers.add(subscriber)
  return () => subscribers.delete(subscriber)
}

/**
 * 相关域名提示：给定页面 URL，从最近流量里找"该页实际请求过的域名"。
 * 判定依据：请求的 Origin/Referer 属于该页，或 host 与页面同域（页面自身请求）。
 */
export function suggestHostsForUrl(pageUrl: string, limit = 12): string[] {
  let page: URL
  try {
    page = new URL(pageUrl)
  } catch {
    return []
  }

  const pageOrigin = page.origin
  const pageHost = page.hostname.toLowerCase()
  const seen = new Set<string>()
  const result: string[] = []

  for (let i = entries.length - 1; i >= 0 && result.length < limit; i--) {
    const entry = entries[i]
    if (seen.has(entry.host)) continue

    const headers = entry.requestHeaders ?? {}
    const origin = headers.origin ?? headers.Origin
    const referer = headers.referer ?? headers.Referer
    const fromPage = origin === pageOrigin
      || (referer ? referer.startsWith(`${pageOrigin}/`) || referer === pageOrigin : false)
      || entry.host === pageHost

    if (!fromPage) continue
    seen.add(entry.host)
    result.push(entry.host)
  }

  return result
}
