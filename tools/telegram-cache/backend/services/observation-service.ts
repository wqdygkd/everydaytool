// M0：被动网络观测（只记录，绝不改写请求）。
//
// 关键取舍：
// 1. **只注册非阻塞回调**：onResponseStarted / onCompleted / onErrorOccurred。
//    不使用 onBeforeRequest / onHeadersReceived / onBeforeSendHeaders —— 它们是阻塞型监听器，
//    必须调用 callback 才能放行请求，一旦漏调就会让页面请求挂起；观测模式不应该进入那条路径。
// 2. 只记录「有 webContents 归属」的请求：主进程自己的 session.fetch（资源下载）没有
//    webContentsId，会被排除，否则下载会被重复计成页面流量。
// 3. 响应体大小只来自 content-length 等响应头 —— webRequest 不暴露真实字节数，
//    因此统计口径必须写清「可观测」而不是「已计量」。
import type {
  TelegramCapabilities,
  TelegramHostStat,
  TelegramObservationStats,
  TelegramResourceType,
  TelegramResourceTypeStat,
  TelegramTrafficEntry,
} from '../../../../shared/telegram-cache.ts'
import type { HttpResourceIdentity } from './identity.ts'
import { createRequire } from 'node:module'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { TELEGRAM_RESOURCE_LIMIT, TELEGRAM_TRAFFIC_LIMIT } from '../../../../shared/telegram-cache.ts'
import { TELEGRAM_WEBVIEW_PARTITION } from '../../../../shared/webview.ts'
import { TELEGRAM_IPC_CHANNELS } from '../ipc/channels.ts'
import { describeUrl } from './identity.ts'
import { getTelegramSession } from './telegram-session.ts'

const require = createRequire(import.meta.url)
const { webContents } = require('electron') as typeof import('electron')

/** 只保留与观测 / 诊断相关的响应头，授权头 / Cookie 一律不进内存 */
const HEADER_WHITELIST = [
  'content-type',
  'content-length',
  'content-encoding',
  'cache-control',
  'etag',
  'last-modified',
  'accept-ranges',
  'age',
  'access-control-allow-origin',
] as const

// 首字节 → 完成之间的响应阶段信息（只用于耗时与状态兜底；不阻塞请求）
interface ResponsePhase {
  at: number
  statusCode?: number
  headers?: Record<string, string>
}

export interface ObservedResource {
  identity: HttpResourceIdentity
  resourceType: TelegramResourceType
  method: string
  mimeType?: string
  size: number
  sizeKnown: boolean
  requests: number
  fromCache: boolean
  statusCode?: number
  firstSeenAt: number
  lastSeenAt: number
  error?: string
}

interface WebRequestLikeDetails {
  id: number
  url: string
  method: string
  webContentsId?: number
  resourceType?: TelegramResourceType
  fromCache?: boolean
  statusCode?: number
  responseHeaders?: Record<string, string[]>
  error?: string
}

let attached = false
let enabled = true
let observingSince: number | null = null
let trafficSeq = 0
let traffic: TelegramTrafficEntry[] = []
let observed = new Map<string, ObservedResource>()
const responsePhases = new Map<number, ResponsePhase>()

const totals = {
  requests: 0,
  completed: 0,
  failed: 0,
  fromCache: 0,
  networkBytes: 0,
  unknownSizeCount: 0,
}

const typeStats = new Map<TelegramResourceType, { requests: number, bytes: number }>()
const hostStats = new Map<string, { requests: number, bytes: number }>()

let changeHandler: (() => void) | null = null

/** 由 snapshot 服务注入：统计数据变化时安排一次节流快照广播 */
export function setTelegramObservationChangeHandler(handler: (() => void) | null): void {
  changeHandler = handler
}

function notifyChanged(): void {
  changeHandler?.()
}

function pickHeaders(responseHeaders?: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {}
  if (!responseHeaders) return out
  // Electron 给的是小写键；仍按小写兜底一次，避免大小写差异导致 content-type 丢失
  const lower = new Map<string, string[]>()
  for (const [name, values] of Object.entries(responseHeaders)) {
    lower.set(name.toLowerCase(), values)
  }
  for (const name of HEADER_WHITELIST) {
    const values = lower.get(name)
    const value = values?.[0]
    if (typeof value === 'string' && value) out[name] = value.slice(0, 512)
  }
  return out
}

function parseContentLength(headers: Record<string, string>): number | null {
  const raw = headers['content-length']
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function mimeOf(headers: Record<string, string>): string | undefined {
  const type = headers['content-type']
  if (!type) return undefined
  return type.split(';')[0]?.trim().toLowerCase() || undefined
}

function bumpType(resourceType: TelegramResourceType, bytes: number): void {
  const entry = typeStats.get(resourceType) ?? { requests: 0, bytes: 0 }
  entry.requests += 1
  entry.bytes += bytes
  typeStats.set(resourceType, entry)
}

function bumpHost(host: string, bytes: number): void {
  const key = host || '(未知主机)'
  const entry = hostStats.get(key) ?? { requests: 0, bytes: 0 }
  entry.requests += 1
  entry.bytes += bytes
  hostStats.set(key, entry)
}

function pushTraffic(entry: TelegramTrafficEntry): void {
  traffic.push(entry)
  if (traffic.length > TELEGRAM_TRAFFIC_LIMIT) {
    traffic = traffic.slice(traffic.length - TELEGRAM_TRAFFIC_LIMIT)
  }
  broadcastToWindows(TELEGRAM_IPC_CHANNELS.EVENT_TRAFFIC, entry, {
    onError: error => logger.warn('Telegram traffic broadcast failed', { error: error.message }),
  })
}

function rememberResource(
  identity: HttpResourceIdentity,
  details: WebRequestLikeDetails,
  info: { mimeType?: string, bytes: number, sizeKnown: boolean, statusCode?: number, fromCache: boolean, error?: string },
): void {
  const key = identity.resourceKey
  const now = Date.now()
  const existing = observed.get(key)
  const next: ObservedResource = {
    identity,
    resourceType: details.resourceType ?? 'other',
    method: details.method,
    mimeType: info.mimeType ?? existing?.mimeType,
    size: info.sizeKnown ? info.bytes : existing?.size ?? 0,
    sizeKnown: info.sizeKnown || existing?.sizeKnown === true,
    requests: (existing?.requests ?? 0) + 1,
    fromCache: info.fromCache,
    statusCode: info.statusCode ?? existing?.statusCode,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    error: info.error,
  }
  // Map 的插入顺序即 FIFO：删除再插入把「刚看到」的资源挪到末尾，淘汰时先丢最久没出现的
  observed.delete(key)
  observed.set(key, next)
  if (observed.size > TELEGRAM_RESOURCE_LIMIT) {
    const oldest = observed.keys().next().value
    if (oldest !== undefined) observed.delete(oldest)
  }
}

function shouldRecord(details: WebRequestLikeDetails): boolean {
  if (!enabled) return false
  // 主进程发起的请求（含本工具自己的下载）没有 webContentsId，不计入页面流量
  if (details.webContentsId == null) return false
  // 只观测本分区内的 webContents：理论上分区独占，这里再做一次归属校验
  const guest = webContents.fromId(details.webContentsId)
  if (!guest || guest.isDestroyed()) return false
  return guest.session === getTelegramSession()
}

function handleResponseStarted(details: WebRequestLikeDetails): void {
  if (!enabled) return
  // 主进程请求（含本工具下载）不需要计时：既不计流量也不进资源清单
  if (details.webContentsId == null) return
  responsePhases.set(details.id, {
    at: Date.now(),
    statusCode: details.statusCode,
    headers: pickHeaders(details.responseHeaders),
  })
  if (responsePhases.size > 600) {
    const oldest = responsePhases.keys().next().value
    if (oldest !== undefined) responsePhases.delete(oldest)
  }
}

function finishRequest(details: WebRequestLikeDetails, error?: string): void {
  const phase = responsePhases.get(details.id)
  responsePhases.delete(details.id)
  if (!shouldRecord(details)) return

  const identity = describeUrl(details.url)
  const headers = phase?.headers ?? pickHeaders(details.responseHeaders)
  const statusCode = details.statusCode ?? phase?.statusCode
  const fromCache = details.fromCache === true
  const contentLength = parseContentLength(headers)
  const sizeKnown = !error && contentLength !== null
  const bytes = sizeKnown ? contentLength ?? 0 : 0
  const mimeType = mimeOf(headers)

  if (!observingSince) observingSince = Date.now()
  totals.requests += 1
  if (error) totals.failed += 1
  else totals.completed += 1
  if (fromCache) totals.fromCache += 1
  if (sizeKnown) {
    // 只有非缓存命中的响应才算「网络接收字节」；来自磁盘缓存的大小单列，不计入网络
    if (!fromCache) totals.networkBytes += bytes
  } else if (!error) {
    totals.unknownSizeCount += 1
  }

  const resourceType = details.resourceType ?? 'other'
  bumpType(resourceType, sizeKnown && !fromCache ? bytes : 0)
  bumpHost(identity?.host ?? '', sizeKnown && !fromCache ? bytes : 0)

  if (identity?.kind === 'resource' && details.method.toUpperCase() === 'GET') {
    rememberResource(identity, details, { mimeType, bytes, sizeKnown, statusCode, fromCache, error })
  }

  pushTraffic({
    id: (trafficSeq += 1),
    at: Date.now(),
    method: details.method || 'GET',
    host: identity?.host ?? '',
    path: identity?.path ?? '',
    resourceType,
    statusCode,
    fromCache,
    bytes: sizeKnown ? bytes : undefined,
    durationMs: phase ? Date.now() - phase.at : undefined,
    mimeType,
    error,
  })

  notifyChanged()
}

function handleCompleted(details: WebRequestLikeDetails): void {
  finishRequest(details)
}

function handleErrorOccurred(details: WebRequestLikeDetails): void {
  finishRequest(details, details.error || '请求失败')
}

/**
 * 挂载观测。必须在后端 initialize 时调用：
 * webview 首次导航前挂好，才能观测到首屏请求（与 webview 的 dom-ready 无关）。
 * 三个监听器都是非阻塞的（没有 callback 参数），因此不存在「忘记回调导致请求挂起」的风险。
 */
export function attachTelegramObservation(): TelegramCapabilities {
  const session = getTelegramSession()
  if (!attached) {
    try {
      const filter = { urls: ['<all_urls>'] }
      session.webRequest.onResponseStarted(filter, details => handleResponseStarted(details))
      session.webRequest.onCompleted(filter, details => handleCompleted(details))
      session.webRequest.onErrorOccurred(filter, details => handleErrorOccurred(details))
      attached = true
      logger.info('Telegram observation attached', { partition: TELEGRAM_WEBVIEW_PARTITION })
    } catch (error) {
      logger.error('Failed to attach Telegram observation', { error: (error as Error).message })
    }
  }
  return getTelegramCapabilities()
}

export function detachTelegramObservation(): void {
  if (!attached) return
  try {
    const session = getTelegramSession()
    session.webRequest.onResponseStarted(null)
    session.webRequest.onCompleted(null)
    session.webRequest.onErrorOccurred(null)
  } catch {
    // 退出流程中 session 可能已销毁，忽略
  }
  attached = false
  responsePhases.clear()
}

export function setTelegramObservationEnabled(next: boolean): void {
  enabled = next
  if (!next) responsePhases.clear()
  notifyChanged()
}

export function isTelegramObservationEnabled(): boolean {
  return enabled
}

export function isTelegramObservationAttached(): boolean {
  return attached
}

export function getObservedResource(resourceKey: string): ObservedResource | undefined {
  return observed.get(resourceKey)
}

export function listObservedResources(): ObservedResource[] {
  return [...observed.values()]
}

export function getTelegramTraffic(): TelegramTrafficEntry[] {
  return [...traffic]
}

export function clearTelegramObservation(): void {
  traffic = []
  trafficSeq = 0
  observed = new Map()
  responsePhases.clear()
  observingSince = null
  totals.requests = 0
  totals.completed = 0
  totals.failed = 0
  totals.fromCache = 0
  totals.networkBytes = 0
  totals.unknownSizeCount = 0
  typeStats.clear()
  hostStats.clear()
  notifyChanged()
}

export function getTelegramObservationStats(): TelegramObservationStats {
  const byType: TelegramResourceTypeStat[] = [...typeStats.entries()]
    .map(([resourceType, stat]) => ({ resourceType, requests: stat.requests, bytes: stat.bytes }))
    .sort((a, b) => b.requests - a.requests)
  const byHost: TelegramHostStat[] = [...hostStats.entries()]
    .map(([host, stat]) => ({ host, requests: stat.requests, bytes: stat.bytes }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 50)
  return {
    enabled,
    observingSince,
    requests: totals.requests,
    completed: totals.completed,
    failed: totals.failed,
    fromCache: totals.fromCache,
    networkBytes: totals.networkBytes,
    unknownSizeCount: totals.unknownSizeCount,
    cacheHitRate: totals.completed > 0 ? totals.fromCache / totals.completed : null,
    byType,
    byHost,
  }
}

export function getTelegramCapabilities(): TelegramCapabilities {
  const notes: string[] = []
  if (!enabled) notes.push('观测已关闭：保留 webRequest 挂载，重新打开后只记录后续请求。')
  notes.push('响应大小来自 content-length 等响应头，缺失该头的响应记为「大小未知」，不计入网络字节。')
  notes.push('只记录有 webContents 归属的请求；主进程自身请求（含本工具下载）不计入页面流量。')
  notes.push('只注册非阻塞回调（onResponseStarted / onCompleted / onErrorOccurred），不存在漏调用回调导致请求挂起的路径。')
  notes.push('本地响应复用（M2）分图片 / 音视频单区间两个开关，默认关闭；过期条目先做条件验证（304 续期，200 失效旧条目）。开启后页面请求可能不再出现在观测里。')
  notes.push('页面数据捕获（M3）通过 CDP 读取页面已完成的图片响应体，默认关闭，与开发者工具互斥。')
  notes.push('页面媒体捕获不覆盖 blob / 播放中数据 / MTProto 明文；独立 MTProto 下载器仍为 false。')
  return {
    httpObservation: attached,
    httpHeaderBytes: true,
    pageMediaCapture: true,
    telegramDownloader: true,
    guestProbe: true,
    // 能力已实现（受配置开关控制）；是否开启见 snapshot.config.localResponseEnabled
    localResponseReplacement: true,
    persistence: 'verified-content-store',
    notes,
  }
}
