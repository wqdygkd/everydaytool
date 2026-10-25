import type { TelegramResourceRecord } from '../store/resource-registry.ts'
// M2：受控的本地响应复用（feature flag，默认关闭）。
//
// 只有同时满足以下条件才用本地文件响应页面请求：
//   http(s) GET · 资源已入库并校验完整 · HTTP 语义允许（图片/音视频 + max-age + 非
//   no-store/private/no-cache + Vary 仅 accept-encoding）· 仍在新鲜期（或 304 验证通过）·
//   对象文件存在 · 当前模式允许该类资源 · 请求未要求绕过缓存。
//
// Range：只支持单区间（206 + Content-Range），多区间/非法区间一律回源；音视频有独立开关。
// 过期：仅对无 Range 的请求做条件验证（If-None-Match / If-Modified-Since）：
//   304 → 刷新新鲜期并返回本地内容；200 → 失效旧条目并把新响应交给页面；其它 → 原样交给页面。
//
// 重要：本处理器通过 session.protocol.handle 拦截整个 Telegram 分区。
// - 安装/卸载完全受配置开关控制，默认不安装；
// - 回源使用 session.fetch(..., bypassCustomProtocolHandlers: true)，不会递归；
// - 开启后页面请求可能不再出现在 webRequest 观测里（取决于 Electron 版本），
//   因此 UI 与文档都明确提示「开启会降低请求观测覆盖」。
import type { CacheFreshness } from './http-semantics.ts'
import { createReadStream, existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { logger } from '../../../../backend/utils/logger.ts'
import { getTelegramCacheConfig } from '../store/config-store.ts'
import {
  getTelegramResourceRecord,
  isTelegramObjectReferenced,
  isVerifiedCompleteRecord,
  removeTelegramResourceRecord,
  resolveTelegramObjectPath,
  touchTelegramResource,
  updateTelegramResourceCache,
} from '../store/resource-registry.ts'
import { hasTelegramArchiveCopy } from './archive-service.ts'
import { noteTelegramLocalHit, noteTelegramLocalMiss, noteTelegramRevalidation } from './cache-manager.ts'
import {
  isCacheFresh,
  parseByteRange,
  refreshFreshnessFrom304,
  remainingFreshSeconds,
} from './http-semantics.ts'
import { describeUrl } from './identity.ts'
import { getTelegramSession } from './telegram-session.ts'

const HANDLED_SCHEMES = ['http', 'https'] as const
/** 命中时更新「最近访问」的节流：避免每张图片都写一次 registry.json */
const TOUCH_THROTTLE_MS = 60_000
const touchedAt = new Map<string, number>()
/** 实际安装成功的 scheme（部分失败时仍能正确卸载已安装的部分） */
const handledSchemes = new Set<string>()

let installed = false

export function isTelegramLocalResponseInstalled(): boolean {
  return installed
}

function modeAllows(cache: CacheFreshness): boolean {
  const config = getTelegramCacheConfig()
  if (cache.serveClass === 'image') return config.localResponseEnabled
  if (cache.serveClass === 'media') return config.localMediaRangeEnabled
  return false
}

function acceptsMimeType(acceptHeader: string, mimeType: string): boolean {
  const accept = acceptHeader.toLowerCase()
  if (!accept || accept.includes('*/*')) return true
  if (accept.includes(mimeType.toLowerCase())) return true
  const [type] = mimeType.toLowerCase().split('/')
  return accept.includes(`${type}/*`)
}

function isEligibleRecord(record: TelegramResourceRecord | undefined): record is TelegramResourceRecord {
  if (!record || !isVerifiedCompleteRecord(record)) return false
  if (!record.mimeType || !record.cache) return false
  if (!record.cache.cacheable) return false
  return modeAllows(record.cache)
}

function baseHeaders(record: TelegramResourceRecord, includeLength: boolean): Headers {
  const cache = record.cache
  const headers = new Headers()
  if (record.mimeType) headers.set('content-type', record.mimeType)
  if (includeLength && record.actualSize) headers.set('content-length', String(record.actualSize))
  if (cache?.etag) headers.set('etag', cache.etag)
  if (cache?.lastModified) headers.set('last-modified', cache.lastModified)
  if (cache) {
    headers.set('cache-control', `public, max-age=${remainingFreshSeconds(cache)}`)
    headers.set('age', String(Math.max(0, Math.floor((Date.now() - cache.storedAt) / 1000))))
    // 跨域 fetch 形态的图片必须回放原 ACAO，否则会被 CORS 拦下
    if (cache.corsAllowOrigin) headers.set('access-control-allow-origin', cache.corsAllowOrigin)
  }
  headers.set('x-edt-telegram-cache', 'hit')
  return headers
}

function maybeTouch(record: TelegramResourceRecord): void {
  const now = Date.now()
  const last = touchedAt.get(record.resourceKey) ?? 0
  if (now - last < TOUCH_THROTTLE_MS) return
  touchedAt.set(record.resourceKey, now)
  try {
    touchTelegramResource(record.resourceKey, 'cache')
  } catch (error) {
    logger.warn('Failed to touch cached resource', { error: (error as Error).message })
  }
}

function normalizeEtag(value: string): string {
  return value.trim().replace(/^W\//i, '')
}

function conditionalMatches(ifNoneMatch: string, etag: string | undefined): boolean {
  if (!etag) return false
  const candidate = normalizeEtag(etag)
  return ifNoneMatch.trim() === '*'
    || ifNoneMatch.split(',').some(token => normalizeEtag(token) === candidate)
}

/**
 * 构造本地响应：无 Range 时 200 整份，单区间时 206。
 * Range 语法不支持（多区间 / 非法）返回 null，由调用方回源，绝不返回错误的区间。
 */
function buildLocalResponse(
  request: Request,
  record: TelegramResourceRecord,
  objectPath: string,
): Response | null {
  const size = record.actualSize ?? 0
  if (!size) return null

  // 页面条件请求：ETag 命中直接 304（仍记一次本地命中）
  const ifNoneMatch = request.headers.get('if-none-match')
  const etag = record.cache?.etag
  if (ifNoneMatch && conditionalMatches(ifNoneMatch, etag)) {
    noteTelegramLocalHit(0)
    maybeTouch(record)
    return new Response(null, { status: 304, headers: baseHeaders(record, false) })
  }

  const rawRange = request.headers.get('range')
  const ifRange = request.headers.get('if-range')
  let effectiveRange = rawRange
  if (rawRange && ifRange) {
    // If-Range 不匹配时按整份响应处理（RFC 9110 §13.1.5）
    const matches = conditionalMatches(ifRange, etag)
      || (Boolean(record.cache?.lastModified) && ifRange.trim() === record.cache?.lastModified)
    if (!matches) effectiveRange = null
  }

  if (effectiveRange) {
    const parsed = parseByteRange(effectiveRange, size)
    if (parsed === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${size}` },
      })
    }
    if (!parsed) return null
    const headers = baseHeaders(record, false)
    headers.set('content-range', `bytes ${parsed.start}-${parsed.end}/${size}`)
    headers.set('content-length', String(parsed.end - parsed.start + 1))
    headers.set('accept-ranges', 'bytes')
    const body = Readable.toWeb(createReadStream(objectPath, { start: parsed.start, end: parsed.end })) as unknown as ReadableStream<Uint8Array>
    noteTelegramLocalHit(parsed.end - parsed.start + 1)
    maybeTouch(record)
    return new Response(body, { status: 206, headers })
  }

  const headers = baseHeaders(record, true)
  headers.set('accept-ranges', 'bytes')
  const body = Readable.toWeb(createReadStream(objectPath)) as unknown as ReadableStream<Uint8Array>
  noteTelegramLocalHit(size)
  maybeTouch(record)
  return new Response(body, { status: 200, headers })
}

/** 200 表示上游内容已变化：失效旧条目（不在这里二次落盘，避免与页面消费抢同一份流量） */
async function invalidateStaleRecord(record: TelegramResourceRecord): Promise<void> {
  // 极端情况：归档只有指针、副本已丢失 → 不删对象，保留唯一内容（条目继续按过期处理）
  if (record.archiveRefs > 0 && !hasTelegramArchiveCopy(record)) return
  removeTelegramResourceRecord(record.resourceKey)
  if (!record.relativePath || isTelegramObjectReferenced(record.relativePath)) return
  const absolute = resolveTelegramObjectPath(record)
  if (!absolute) return
  try {
    await rm(absolute, { force: true })
  } catch (error) {
    logger.warn('Failed to remove invalidated cached object', { error: (error as Error).message })
  }
}

function parseAgeHeader(raw: string | null): number | null {
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * 过期条目的条件验证。只对无 Range 的请求执行（带 Range 的交给源站，避免把 200 整份响应
 * 塞给期待 206 的播放器）。
 */
async function revalidateStale(
  request: Request,
  record: TelegramResourceRecord,
  objectPath: string,
): Promise<Response | null> {
  const cache = record.cache
  if (!cache) return null
  if (request.headers.has('range')) return null
  if (!cache.etag && !cache.lastModified) return null

  const identity = describeUrl(request.url)
  if (!identity || identity.kind !== 'resource' || !identity.downloadable) return null

  const headers = new Headers()
  if (cache.etag) headers.set('if-none-match', cache.etag)
  if (cache.lastModified) headers.set('if-modified-since', cache.lastModified)
  // 只转发与内容协商相关的安全头；Cookie / Authorization 由 session 自己带，不在这里拼
  for (const name of ['accept', 'accept-language', 'referer', 'origin']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  let response: Response
  try {
    response = await getTelegramSession().fetch(identity.fetchUrl, {
      method: 'GET',
      headers,
      redirect: 'follow',
      bypassCustomProtocolHandlers: true,
    })
  } catch (error) {
    logger.warn('Cache revalidation request failed, falling back to network', {
      error: (error as Error).message,
    })
    return null
  }

  const hit = response.status === 304
  noteTelegramRevalidation(hit)

  if (hit) {
    const refreshed = refreshFreshnessFrom304(cache, {
      cacheControl: response.headers.get('cache-control'),
      ageSeconds: parseAgeHeader(response.headers.get('age')),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      corsAllowOrigin: response.headers.get('access-control-allow-origin'),
      storedAt: Date.now(),
    })
    // 304 但新头不再允许本地复用 / 没有新鲜期：退回网络路径
    if (!refreshed.cacheable || !isCacheFresh(refreshed)) return null
    updateTelegramResourceCache(record.resourceKey, refreshed)
    return buildLocalResponse(request, { ...record, cache: refreshed }, objectPath)
  }

  if (response.status === 200) {
    await invalidateStaleRecord(record)
    return response
  }

  // 5xx / 重定向等交给页面处理（保持原响应语义）
  return response
}

/** 尝试用本地对象完成请求；返回 null 表示必须回源。任何异常都由调用方回源。 */
async function tryServeLocally(request: Request): Promise<Response | null> {
  if (!installed) return null
  if (request.method !== 'GET') return null
  // 页面明确要求绕过缓存（强制刷新 / DevTools 关缓存）时必须回源
  const requestCacheControl = (request.headers.get('cache-control') ?? '').toLowerCase()
  if (requestCacheControl.includes('no-cache') || requestCacheControl.includes('no-store')) return null
  if ((request.headers.get('pragma') ?? '').toLowerCase().includes('no-cache')) return null

  const identity = describeUrl(request.url)
  if (!identity || identity.kind !== 'resource' || !identity.downloadable) return null

  const record = getTelegramResourceRecord(identity.resourceKey)
  if (!isEligibleRecord(record)) return null
  if (!record.cache) return null

  const accept = request.headers.get('accept')
  if (accept && !acceptsMimeType(accept, record.mimeType ?? '')) return null

  const objectPath = resolveTelegramObjectPath(record)
  if (!objectPath || !existsSync(objectPath)) return null

  if (isCacheFresh(record.cache)) {
    // 新鲜期不足 1 秒时直接回源，避免返回 max-age=0 的响应
    if (remainingFreshSeconds(record.cache) <= 0) return null
    return buildLocalResponse(request, record, objectPath)
  }

  return revalidateStale(request, record, objectPath)
}

async function handleProtocolRequest(request: Request): Promise<Response> {
  const session = getTelegramSession()
  try {
    const served = await tryServeLocally(request)
    if (served) return served
    noteTelegramLocalMiss()
  } catch (error) {
    noteTelegramLocalMiss()
    logger.warn('Local response failed, falling back to network', {
      host: describeUrl(request.url)?.host ?? '',
      error: (error as Error).message,
    })
  }
  // 必须绕过自定义协议处理器，否则会再次进入本函数形成递归
  return session.fetch(request, { bypassCustomProtocolHandlers: true })
}

export function installTelegramLocalResponse(): boolean {
  if (installed) return true
  const session = getTelegramSession()
  handledSchemes.clear()
  for (const scheme of HANDLED_SCHEMES) {
    try {
      session.protocol.handle(scheme, handleProtocolRequest)
      handledSchemes.add(scheme)
    } catch {
      try {
        session.protocol.unhandle(scheme)
        session.protocol.handle(scheme, handleProtocolRequest)
        handledSchemes.add(scheme)
      } catch (error) {
        logger.error('Failed to install local response handler', {
          scheme,
          error: (error as Error).message,
        })
      }
    }
  }
  installed = handledSchemes.size > 0
  if (installed) logger.info('Telegram local response handler installed', { schemes: [...handledSchemes] })
  return installed
}

export function uninstallTelegramLocalResponse(): void {
  if (!installed && handledSchemes.size === 0) return
  const session = getTelegramSession()
  for (const scheme of handledSchemes) {
    try {
      session.protocol.unhandle(scheme)
    } catch {
      // 未注册 / session 已销毁：忽略
    }
  }
  handledSchemes.clear()
  installed = false
  touchedAt.clear()
  logger.info('Telegram local response handler uninstalled')
}

/** 配置驱动的安装/卸载：图片与音视频 Range 任一开启都需要处理器 */
export function syncTelegramLocalResponseWithConfig(): boolean {
  const config = getTelegramCacheConfig()
  const enabled = config.localResponseEnabled || config.localMediaRangeEnabled
  if (enabled) {
    if (!installed) installTelegramLocalResponse()
  } else if (installed) {
    uninstallTelegramLocalResponse()
  }
  return installed
}

export function disposeTelegramLocalResponse(): void {
  uninstallTelegramLocalResponse()
}
