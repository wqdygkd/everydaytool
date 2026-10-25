// HTTP 缓存语义（M2，纯函数，无 Node / Electron 依赖，便于自检）：
// - 只解析本工具需要的子集：no-store / no-cache / private / public / max-age / must-revalidate /
//   immutable / Vary / ETag / Last-Modified / Age。
// - **不使用启发式新鲜度**（没有 max-age 就不本地复用），保守优先。
// - 本地响应按 MIME 分类：图片整份复用；音视频只走单区间 Range（由 localMediaRangeEnabled 独立开关控制）。
import type { TelegramServeClass } from '../../../../shared/telegram-cache.ts'
import { TELEGRAM_LOCAL_RESPONSE_MIME_PREFIX } from '../../../../shared/telegram-cache.ts'

export interface ParsedCacheControl {
  raw?: string
  noStore: boolean
  noCache: boolean
  private: boolean
  public: boolean
  maxAgeSeconds: number | null
  mustRevalidate: boolean
  immutable: boolean
}

/** 允许出现的 Vary 维度：accept-encoding 由我们的「解压后字节」口径吸收，其余维度一律不本地复用 */
const ACCEPTABLE_VARY_TOKENS = new Set(['accept-encoding'])

export function parseCacheControl(raw: string | null | undefined): ParsedCacheControl {
  const result: ParsedCacheControl = {
    raw: raw ?? undefined,
    noStore: false,
    noCache: false,
    private: false,
    public: false,
    maxAgeSeconds: null,
    mustRevalidate: false,
    immutable: false,
  }
  if (!raw) return result

  for (const part of raw.split(',')) {
    const [rawKey, rawValue] = part.trim().split('=')
    const key = rawKey?.trim().toLowerCase()
    if (!key) continue
    const value = rawValue?.trim().replace(/^"(.*)"$/, '$1')
    switch (key) {
      case 'no-store':
        result.noStore = true
        break
      case 'no-cache':
        result.noCache = true
        break
      case 'private':
        result.private = true
        break
      case 'public':
        result.public = true
        break
      case 'must-revalidate':
        result.mustRevalidate = true
        break
      case 'immutable':
        result.immutable = true
        break
      case 'max-age': {
        const seconds = Number(value)
        if (Number.isFinite(seconds) && seconds >= 0) result.maxAgeSeconds = Math.floor(seconds)
        break
      }
      default:
        break
    }
  }
  return result
}

export function parseVary(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw.split(',').map(token => token.trim().toLowerCase()).filter(Boolean)
}

/** Vary 只有 accept-encoding（或为空）时才允许本地复用，避免把带 cookie/ua 的变体当同一份内容 */
export function isVaryAcceptable(vary: string | null | undefined): boolean {
  return parseVary(vary).every(token => ACCEPTABLE_VARY_TOKENS.has(token))
}

export interface CacheFreshness {
  /** 原始 Cache-Control（脱敏后落索引；不含任何凭据） */
  cacheControl?: string
  etag?: string
  lastModified?: string
  vary?: string
  /** 原响应的 ACAO：本地响应必须原样回放，否则跨域 fetch 形态的图片会被 CORS 拦下 */
  corsAllowOrigin?: string
  noStore: boolean
  noCache: boolean
  private: boolean
  maxAgeSeconds: number | null
  quotaManaged: boolean
  /** 允许作为本地响应复用 */
  cacheable: boolean
  /** 本地响应类别：图片整份 / 音视频单区间 / 不可复用 */
  serveClass: TelegramServeClass
  /** 过期时刻（ms）；null = 没有可用的新鲜度信息，永不本地复用 */
  freshUntil: number | null
  storedAt: number
}

export interface EvaluateCachingInput {
  mimeType?: string
  statusCode?: number
  cacheControl?: string | null
  etag?: string | null
  lastModified?: string | null
  vary?: string | null
  corsAllowOrigin?: string | null
  /** 上游 Age 头（秒）：已经存在于中间缓存的时间要从新鲜期里扣掉 */
  ageSeconds?: number | null
  storedAt: number
}

/**
 * 计算一条响应能否进入「可本地复用」的缓存：
 * 需要同时满足图片 / 音视频 MIME、200、未声明 no-store / private / no-cache、max-age > 0、
 * Vary 可接受（仅 accept-encoding）。其余情况仍可归档，但永不自动替换页面请求。
 */
export function evaluateResponseCaching(input: EvaluateCachingInput): CacheFreshness {
  const parsed = parseCacheControl(input.cacheControl ?? undefined)
  const vary = input.vary ?? undefined
  const age = Number.isFinite(input.ageSeconds ?? NaN) ? Math.max(0, Number(input.ageSeconds)) : 0
  const freshUntil = parsed.maxAgeSeconds === null
    ? null
    : input.storedAt + Math.max(0, parsed.maxAgeSeconds - age) * 1000
  const mimeType = input.mimeType ?? ''
  const serveClass: TelegramServeClass = mimeType.startsWith(TELEGRAM_LOCAL_RESPONSE_MIME_PREFIX)
    ? 'image'
    : (mimeType.startsWith('video/') || mimeType.startsWith('audio/') ? 'media' : 'none')
  const cacheable = serveClass !== 'none'
    && input.statusCode === 200
    && !parsed.noStore
    && !parsed.private
    && !parsed.noCache
    && parsed.maxAgeSeconds !== null
    && parsed.maxAgeSeconds > 0
    && isVaryAcceptable(vary)

  return {
    cacheControl: input.cacheControl ?? undefined,
    etag: input.etag ?? undefined,
    lastModified: input.lastModified ?? undefined,
    vary,
    corsAllowOrigin: input.corsAllowOrigin ?? undefined,
    noStore: parsed.noStore,
    noCache: parsed.noCache,
    private: parsed.private,
    maxAgeSeconds: parsed.maxAgeSeconds,
    // no-store 内容只为用户主动归档保留，不占缓存配额、不参与 LRU
    quotaManaged: !parsed.noStore,
    cacheable,
    serveClass,
    freshUntil,
    storedAt: input.storedAt,
  }
}

export function isCacheFresh(freshness: CacheFreshness | undefined, now = Date.now()): boolean {
  if (!freshness || !freshness.cacheable) return false
  return freshness.freshUntil !== null && freshness.freshUntil > now
}

/** 本地响应返回给页面的剩余新鲜期（秒，至少 0） */
export function remainingFreshSeconds(freshness: CacheFreshness, now = Date.now()): number {
  if (freshness.freshUntil === null) return 0
  return Math.max(0, Math.floor((freshness.freshUntil - now) / 1000))
}

/**
 * 304 之后刷新缓存新鲜期：304 可以只带部分头，缺省字段沿用旧响应（RFC 9111 语义）。
 * 只重算新鲜期与可复用标志，不改内容标识（sha256 / size 由内容对象保证）。
 */
export function refreshFreshnessFrom304(
  previous: CacheFreshness,
  input: {
    cacheControl?: string | null
    ageSeconds?: number | null
    etag?: string | null
    lastModified?: string | null
    corsAllowOrigin?: string | null
    storedAt: number
  },
): CacheFreshness {
  const cacheControl = input.cacheControl ?? previous.cacheControl
  const parsed = parseCacheControl(cacheControl)
  const maxAgeSeconds = parsed.maxAgeSeconds ?? previous.maxAgeSeconds
  const age = Number.isFinite(input.ageSeconds ?? NaN) ? Math.max(0, Number(input.ageSeconds)) : 0
  const freshUntil = maxAgeSeconds === null
    ? null
    : input.storedAt + Math.max(0, maxAgeSeconds - age) * 1000
  const cacheable = previous.serveClass !== 'none'
    && !parsed.noStore
    && !parsed.private
    && !parsed.noCache
    && maxAgeSeconds !== null
    && maxAgeSeconds > 0
    && isVaryAcceptable(previous.vary)
  return {
    ...previous,
    cacheControl,
    etag: input.etag ?? previous.etag,
    lastModified: input.lastModified ?? previous.lastModified,
    corsAllowOrigin: input.corsAllowOrigin ?? previous.corsAllowOrigin,
    noStore: parsed.noStore,
    noCache: parsed.noCache,
    private: parsed.private,
    maxAgeSeconds,
    cacheable,
    freshUntil,
    storedAt: input.storedAt,
  }
}

/** 单区间解析结果：null = 不支持 / 多区间（回源）；unsatisfiable = 416 */
export type ParsedByteRange = { start: number, end: number } | 'unsatisfiable' | null

/**
 * 解析 `Range: bytes=start-end`（单区间）。
 * 多区间（逗号）、非法语法、非法区间一律返回 null 由调用方回源——
 * 我们不做 multipart/byteranges，避免把错误区间拼给播放器。
 */
export function parseByteRange(header: string | null | undefined, size: number): ParsedByteRange {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null
  if (!Number.isFinite(size) || size <= 0) return 'unsatisfiable'

  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(rawStart)
  if (!Number.isFinite(start) || start < 0 || start >= size) return 'unsatisfiable'
  let end = rawEnd === '' ? size - 1 : Number(rawEnd)
  if (!Number.isFinite(end) || end < start) return null
  if (end >= size) end = size - 1
  return { start, end }
}
