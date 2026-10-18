// 处理名单匹配（edt 处理层过滤器：命中才拆包/改包/记日志，否则透传）。
// 条目语义见 docs/interceptor.md §3：exact（可带端口）/ suffix（命中本体与子域）/ regex（对 host）。
import type { InterceptorTarget } from '../../../../shared/interceptor.ts'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

export function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host)
  return LOOPBACK_HOSTS.has(normalized) || normalized.startsWith('127.')
}

export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^\[|\]$/g, '')
}

const REGEX_CACHE_MAX = 500
const regexCache = new Map<string, RegExp | null>()

function compileRegex(pattern: string): RegExp | null {
  const cached = regexCache.get(pattern)
  if (cached !== undefined) return cached
  let compiled: RegExp | null = null
  try {
    compiled = new RegExp(pattern)
  } catch {
    compiled = null
  }
  // 用户输入驱动，封顶防无限增长：淘汰最早插入的一项（本地工具场景 FIFO 足够）
  if (regexCache.size >= REGEX_CACHE_MAX) {
    const oldest = regexCache.keys().next().value
    if (oldest !== undefined) regexCache.delete(oldest)
  }
  regexCache.set(pattern, compiled)
  return compiled
}

export function matchTarget(targets: InterceptorTarget[], host: string, port?: number): InterceptorTarget | null {
  const normalizedHost = normalizeHost(host)

  for (const target of targets) {
    if (target.port !== undefined && target.port !== port) continue

    switch (target.matchType) {
      case 'exact':
        if (normalizeHost(target.host) === normalizedHost) return target
        break
      case 'suffix': {
        const suffix = normalizeHost(target.host)
        if (normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`)) return target
        break
      }
      case 'regex': {
        const regex = compileRegex(target.host)
        if (regex?.test(normalizedHost)) return target
        break
      }
    }
  }

  return null
}

/** 展示用：`host:port` / `host` */
export function formatTargetHost(host: string, port?: number): string {
  return port === undefined ? host : `${host}:${port}`
}
