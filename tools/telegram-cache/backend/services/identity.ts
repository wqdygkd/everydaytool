// 资源身份解析（对应方案文档 §5）：URL 只作为「本次会话可复查的地址」，
// 身份键是规范化 URL 的哈希，显示地址一律脱敏。
//
// 保守策略：**不删任何 query 参数**。文档要求「只删除经过验证的无语义跟踪参数」，
// 而 Telegram 的短期签名恰好放在 query 里，贸然归一化会把不同资源压成同一个键
// （错误命中比不命中更糟）。因此键 = origin + pathname + search 的哈希，只去掉 fragment。
import { createHash } from 'node:crypto'

export type UrlSchemeKind = 'http' | 'websocket' | 'opaque'

export interface HttpResourceIdentity {
  kind: 'resource'
  resourceKey: string
  /** 完整地址（仅主进程内存持有，用于 session.fetch / 下载；不写日志、不落盘） */
  fetchUrl: string
  /** 脱敏展示地址：查询参数值一律 */
  displayUrl: string
  host: string
  path: string
  scheme: 'http' | 'https' | 'ws' | 'wss'
  downloadable: boolean
}

export interface OpaqueUrlIdentity {
  kind: 'opaque'
  displayUrl: string
  host: string
  path: string
  scheme: string
}

export type UrlIdentity = HttpResourceIdentity | OpaqueUrlIdentity

const MAX_DISPLAY_PATH = 160
const MAX_DISPLAY_QUERY_KEYS = 4

function cleanText(value: string): string {
  // 去掉控制字符，避免把不可见内容写进诊断包 / 表格
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function sanitizeSearch(search: string): string {
  if (!search || search === '?') return ''
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search)
  } catch {
    return '?***'
  }
  const keys = [...params.keys()]
  if (!keys.length) return '?***'
  const shown = keys.slice(0, MAX_DISPLAY_QUERY_KEYS).map(key => `${cleanText(key)}=***`)
  if (keys.length > MAX_DISPLAY_QUERY_KEYS) shown.push(`…共 ${keys.length} 个参数`)
  return `?${shown.join('&')}`
}

export function hashResourceIdentity(normalized: string): string {
  return createHash('sha256').update(normalized, 'utf8').digest('hex')
}

/**
 * 解析任意 URL：
 * - http(s)：可复用（fetchUrl 保留完整 query），键前缀 http:v1:
 * - ws(s)：可观测但不可下载，键前缀 ws:v1:
 * - blob: / data: / 其它：只能展示，拿不到可复用地址
 */
export function describeUrl(rawUrl: string): UrlIdentity | null {
  const raw = typeof rawUrl === 'string' ? rawUrl.trim() : ''
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  const scheme = url.protocol.replace(/:$/, '').toLowerCase()
  const host = cleanText(url.host || url.hostname || '')
  const displayPath = truncate(cleanText(url.pathname || '/'), MAX_DISPLAY_PATH) + sanitizeSearch(url.search)

  if (scheme === 'http' || scheme === 'https' || scheme === 'ws' || scheme === 'wss') {
    // 规范化：origin（大小写 / 默认端口已由 URL 归一）+ pathname + search；丢弃 hash 与凭据
    const normalized = `${url.origin}${url.pathname}${url.search}`
    const digest = hashResourceIdentity(normalized)
    const isHttp = scheme === 'http' || scheme === 'https'
    return {
      kind: 'resource',
      resourceKey: `${isHttp ? 'http' : 'ws'}:v1:${digest.slice(0, 40)}`,
      fetchUrl: isHttp ? `${url.origin}${url.pathname}${url.search}` : '',
      displayUrl: `${scheme}://${host}${displayPath}`,
      host,
      path: displayPath,
      scheme: scheme as 'http' | 'https' | 'ws' | 'wss',
      downloadable: isHttp,
    }
  }

  return {
    kind: 'opaque',
    displayUrl: `${scheme}:${truncate(cleanText(host || raw.slice(scheme.length + 1)), MAX_DISPLAY_PATH)}`,
    host: '',
    path: truncate(cleanText(url.pathname || raw), MAX_DISPLAY_PATH),
    scheme,
  }
}

/** 只接受本工具写入的键格式（IPC 入参校验用，避免渲染层伪造任意键） */
export function isTelegramResourceKey(value: unknown): value is string {
  return typeof value === 'string' && /^(?:http|ws):v1:[0-9a-f]{40}$/.test(value)
}
