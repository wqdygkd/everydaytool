import type { WebContents } from 'electron'
// M3 路径 A：页面数据捕获适配器（CDP Network 域，默认关闭）。
//
// 目标：页面已经下载完成的图片字节，不再从网络下载第二遍——直接哈希、落库、进索引。
// 边界（必须写在 UI / 文档里）：
// - 只能拿到普通 HTTP 响应体。blob: / 播放中数据 / MTProto 明文不在 CDP 的可见范围；
// - 只抓图片（首轮验证范围），单文件上限 16MB；
// - 占用 guest 的调试通道，与开发者工具互斥：DevTools 打开会 detach 我们的 debugger，
//   此时捕获自动停止并记录原因，页面本身不受影响；
// - 附件只读：不修改响应、不注入脚本。
import type { TelegramFeasibilityReport } from '../../../../shared/telegram-cache.ts'
import type { HttpResourceIdentity } from './identity.ts'
import { Buffer } from 'node:buffer'
import { logger } from '../../../../backend/utils/logger.ts'
import { getTelegramCacheConfig } from '../store/config-store.ts'
import { storeCapturedContent } from './download-service.ts'
import { evaluateResponseCaching } from './http-semantics.ts'
import { describeUrl } from './identity.ts'
import { getTelegramObservationStats } from './observation-service.ts'
import { getAttachedPageId, getLastProbe, resolveTelegramGuest } from './probe-service.ts'

const MAX_CAPTURE_BYTES = 16 * 1024 * 1024
const MAX_PENDING = 200

interface PendingResponse {
  identity: HttpResourceIdentity
  mimeType: string
  statusCode: number
  headers: Record<string, string>
  encodedDataLength: number | null
}

interface CaptureMeters {
  hits: number
  misses: number
  bytes: number
}

const meters: CaptureMeters = { hits: 0, misses: 0, bytes: 0 }
const pending = new Map<string, PendingResponse>()

let enabled = false
let attachedWebContentsId: number | null = null
let attachError: string | null = null
let messageListener: ((event: unknown, method: string, params: unknown) => void) | null = null
let detachListener: ((event: unknown, reason: string) => void) | null = null
let changeHandler: (() => void) | null = null
let queue: Promise<void> = Promise.resolve()

export interface PageCaptureStats {
  enabled: boolean
  attached: boolean
  hits: number
  misses: number
  bytes: number
  error: string | null
}

export function setPageCaptureChangeHandler(handler: (() => void) | null): void {
  changeHandler = handler
}

function notifyChanged(): void {
  changeHandler?.()
}

export function getPageCaptureStats(): PageCaptureStats {
  return {
    enabled,
    attached: attachedWebContentsId !== null,
    hits: meters.hits,
    misses: meters.misses,
    bytes: meters.bytes,
    error: attachError,
  }
}

function lowerHeaders(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof headers !== 'object' || headers === null) return out
  for (const [name, value] of Object.entries(headers as Record<string, unknown>)) {
    if (value === null || value === undefined) continue
    out[name.toLowerCase()] = String(value).slice(0, 512)
  }
  return out
}

function parseAge(value: string | undefined): number | null {
  if (!value) return null
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? num : null
}

function handleResponseReceived(params: Record<string, unknown>): void {
  const type = String(params.type ?? '')
  // 首轮只验证图片；视频/音频体积大，先不做页面捕获
  if (type !== 'Image') return
  const response = (typeof params.response === 'object' && params.response !== null
    ? params.response
    : {}) as Record<string, unknown>
  const mimeType = String(response.mimeType ?? '').toLowerCase()
  if (!mimeType.startsWith('image/')) return
  const identity = describeUrl(String(response.url ?? ''))
  if (!identity || identity.kind !== 'resource' || !identity.downloadable) return
  const requestId = String(params.requestId ?? '')
  if (!requestId) return
  pending.set(requestId, {
    identity,
    mimeType,
    statusCode: Number(response.status) || 0,
    headers: lowerHeaders(response.headers),
    encodedDataLength: null,
  })
  if (pending.size > MAX_PENDING) {
    const oldest = pending.keys().next().value
    if (oldest !== undefined) pending.delete(oldest)
  }
}

function handleLoadingFinished(params: Record<string, unknown>): void {
  const requestId = String(params.requestId ?? '')
  const entry = pending.get(requestId)
  if (!entry) return
  pending.delete(requestId)
  entry.encodedDataLength = Number(params.encodedDataLength) || null
  if (entry.encodedDataLength !== null && entry.encodedDataLength > MAX_CAPTURE_BYTES) {
    meters.misses += 1
    notifyChanged()
    return
  }
  // 串行消费，避免同一时刻大量 getResponseBody 占满主进程
  queue = queue
    .then(() => captureBody(requestId, entry))
    .catch((error: unknown) => {
      meters.misses += 1
      logger.warn('Page capture failed', { error: (error as Error).message })
      notifyChanged()
    })
}

function handleLoadingFailed(params: Record<string, unknown>): void {
  const requestId = String(params.requestId ?? '')
  if (requestId) pending.delete(requestId)
}

async function captureBody(requestId: string, entry: PendingResponse): Promise<void> {
  if (!enabled || attachedWebContentsId === null) return
  const guest = resolveTelegramGuest(attachedWebContentsId)
  if (!guest || !guest.debugger.isAttached()) return

  let raw: unknown
  try {
    raw = await guest.debugger.sendCommand('Network.getResponseBody', { requestId })
  } catch (error) {
    meters.misses += 1
    // body 已被 Chromium 回收 / 调试器已分离：只记一次 miss，不重试
    logger.debug('Page capture body unavailable', { error: (error as Error).message })
    notifyChanged()
    return
  }

  const result = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const encoded = result.base64Encoded === true
  const bodyText = typeof result.body === 'string' ? result.body : ''
  if (!bodyText) {
    meters.misses += 1
    notifyChanged()
    return
  }
  const body = encoded ? Buffer.from(bodyText, 'base64') : Buffer.from(bodyText, 'utf8')
  if (body.length === 0 || body.length > MAX_CAPTURE_BYTES) {
    meters.misses += 1
    notifyChanged()
    return
  }

  const cache = evaluateResponseCaching({
    mimeType: entry.mimeType,
    statusCode: entry.statusCode,
    cacheControl: entry.headers['cache-control'],
    etag: entry.headers.etag,
    lastModified: entry.headers['last-modified'],
    vary: entry.headers.vary,
    corsAllowOrigin: entry.headers['access-control-allow-origin'],
    ageSeconds: parseAge(entry.headers.age),
    storedAt: Date.now(),
  })

  try {
    await storeCapturedContent({
      resourceKey: entry.identity.resourceKey,
      displayUrl: entry.identity.displayUrl,
      host: entry.identity.host,
      mimeType: entry.mimeType,
      body,
      cache,
    })
    meters.hits += 1
    meters.bytes += body.length
  } catch (error) {
    meters.misses += 1
    logger.warn('Failed to store page-captured content', { error: (error as Error).message })
  } finally {
    notifyChanged()
  }
}

function removeListeners(guest: WebContents): void {
  try {
    if (messageListener) guest.debugger.removeListener('message', messageListener)
    if (detachListener) guest.debugger.removeListener('detach', detachListener)
  } catch {
    // webContents 已销毁，忽略
  }
  messageListener = null
  detachListener = null
}

export function detachPageCapture(): void {
  const id = attachedWebContentsId
  attachedWebContentsId = null
  pending.clear()
  if (id === null) return
  const guest = resolveTelegramGuest(id)
  if (!guest) return
  removeListeners(guest)
  try {
    if (guest.debugger.isAttached()) {
      void guest.debugger.sendCommand('Network.disable').catch(() => {})
      guest.debugger.detach()
    }
  } catch {
    // 已分离，忽略
  }
  notifyChanged()
}

export function attachPageCapture(webContentsId: number): boolean {
  const guest = resolveTelegramGuest(webContentsId)
  if (!guest) {
    attachError = '页面内核不可用或不属于 telegram-cache 分区'
    notifyChanged()
    return false
  }
  if (attachedWebContentsId === guest.id && guest.debugger.isAttached()) {
    attachError = null
    return true
  }

  detachPageCapture()
  try {
    // 与 DevTools 互斥：已被占用时 attach 会抛错
    guest.debugger.attach('1.3')
  } catch (error) {
    attachError = `无法附加调试器（可能已被开发者工具占用）：${(error as Error).message}`
    notifyChanged()
    return false
  }

  messageListener = (_event, method, params) => {
    if (method !== 'Network.responseReceived' && method !== 'Network.loadingFinished' && method !== 'Network.loadingFailed') return
    const payload = (typeof params === 'object' && params !== null ? params : {}) as Record<string, unknown>
    if (method === 'Network.responseReceived') handleResponseReceived(payload)
    else if (method === 'Network.loadingFinished') handleLoadingFinished(payload)
    else handleLoadingFailed(payload)
  }
  detachListener = (_event, reason) => {
    attachedWebContentsId = null
    pending.clear()
    attachError = `调试器已分离：${reason || 'unknown'}`
    notifyChanged()
  }
  guest.debugger.on('message', messageListener)
  guest.debugger.on('detach', detachListener)

  void guest.debugger.sendCommand('Network.enable', {
    maxTotalBufferSize: 64 * 1024 * 1024,
    maxResourceBufferSize: MAX_CAPTURE_BYTES + 4 * 1024 * 1024,
  }).catch((error: unknown) => {
    attachError = `Network.enable 失败：${(error as Error).message}`
    notifyChanged()
  })

  attachedWebContentsId = guest.id
  attachError = null
  logger.info('Page capture attached', { webContentsId: guest.id })
  notifyChanged()
  return true
}

/** 配置 / 页面 attach 后同步：开关关闭一律 detach；开启时绑定当前页面 */
export function syncPageCaptureWithConfig(): boolean {
  const config = getTelegramCacheConfig()
  enabled = config.enablePageCapture
  if (!enabled) {
    if (attachedWebContentsId !== null) detachPageCapture()
    else notifyChanged()
    return false
  }
  const pageId = getAttachedPageId()
  if (pageId !== null) return attachPageCapture(pageId)
  notifyChanged()
  return false
}

export function disposePageCapture(): void {
  enabled = false
  detachPageCapture()
}

/** 供 M3 可行性报告使用：捕获能力与限制（不触发任何附加操作） */
export function describePageCaptureCapability(): TelegramFeasibilityReport['capture'] {
  const stats = getPageCaptureStats()
  return {
    available: true,
    enabled: stats.enabled,
    attached: stats.attached,
    hits: stats.hits,
    misses: stats.misses,
    capturedBytes: stats.bytes,
    supported: ['image/*（已完成下载的 HTTP 响应体，单文件 ≤ 16MB）'],
    limitations: [
      '拿不到 blob: / 播放中数据 / MTProto 明文——这些不在 CDP Network 的可见范围',
      '与开发者工具互斥：DevTools 打开会 detach 捕获器',
      'body 可能已被 Chromium 回收（此时记一次 miss，不重试）',
      '只读：不修改响应、不注入页面脚本',
    ],
  }
}

/** 供可行性报告使用的页面线索（最近一次只读探测） */
export function getLastPageProbeClues(): { blobUrlCount: number | null, serviceWorkerActive: boolean | null, mediaElementCount: number | null } {
  const probe = getLastProbe()
  return {
    blobUrlCount: probe?.ok ? probe.blobUrlCount : null,
    serviceWorkerActive: probe?.ok ? probe.serviceWorkerActive : null,
    mediaElementCount: probe?.ok ? probe.mediaElementCount : null,
  }
}

/** 观测流量分类（供报告判断 HTTP / 非 HTTP 路径占比） */
export function getTrafficClassification(): { websocketRequests: number, imageRequests: number, mediaRequests: number } {
  const stats = getTelegramObservationStats()
  const find = (type: string): number => stats.byType.find(item => item.resourceType === type)?.requests ?? 0
  return {
    websocketRequests: find('webSocket'),
    imageRequests: find('image'),
    mediaRequests: find('media'),
  }
}
