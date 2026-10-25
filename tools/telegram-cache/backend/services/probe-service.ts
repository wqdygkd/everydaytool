// 页面侧能力探测（只读，不改页面、不注入依赖）：
// - 在 guest 页面执行一段固定脚本，读取 performance / 媒体元素 / Service Worker 等公开线索；
// - 返回结果全部按白名单强制转型（远程页面返回的任何对象都不可信）；
// - 同时给 guest 装导航 allowlist：只允许 Telegram 自己的域名，其它 http(s) 交给系统浏览器。
import type { WebContents } from 'electron'
import type { TelegramPageProbe } from '../../../../shared/telegram-cache.ts'
import { createRequire } from 'node:module'
import { logger } from '../../../../backend/utils/logger.ts'
import { describeUrl } from './identity.ts'
import { getTelegramSession } from './telegram-session.ts'

const require = createRequire(import.meta.url)
const { shell, webContents } = require('electron') as typeof import('electron')

/** 允许在 webview 内导航的域名（登录 / 聊天主界面）；其它一律外跳或拦截 */
const ALLOWED_HOSTS = ['web.telegram.org', 'telegram.org', 'www.telegram.org', 't.me', 'www.t.me']

let attachedPageId: number | null = null
const attachedCleanup: Array<() => void> = []

function isAllowedTelegramHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return ALLOWED_HOSTS.includes(normalized)
    || normalized.endsWith('.telegram.org')
    || normalized.endsWith('.t.me')
}

function isHttpUrl(rawUrl: string): boolean {
  try {
    const { protocol } = new URL(rawUrl)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** 外部跳转统一交给主进程 shell（只放行 http(s)），不在 webview 内打开未知站点 */
function openExternalSafely(rawUrl: string): void {
  if (!isHttpUrl(rawUrl)) return
  void shell.openExternal(rawUrl.trim())
}

function releasePageHandlers(): void {
  for (const dispose of attachedCleanup.splice(0)) {
    try {
      dispose()
    } catch {
      // webContents 已销毁时移除监听可能抛错，忽略
    }
  }
  attachedPageId = null
}

/**
 * 把渲染层传来的 webContentsId 解析成 Telegram 分区的 guest 页面。
 * 渲染层的数值不可信：必须同时校验存活、分区一致，否则返回 null。
 * 供页面探测、页面捕获、attach 共用。
 */
export function resolveTelegramGuest(webContentsId: number): WebContents | null {
  if (!Number.isFinite(webContentsId) || webContentsId <= 0) return null
  const guest = webContents.fromId(webContentsId)
  if (!guest || guest.isDestroyed()) return null
  // 只接受本工具分区内的 webContents：渲染层传上来的 id 不可信，不能借它操作别的页面
  if (guest.session !== getTelegramSession()) return null
  return guest
}

/**
 * 绑定一个 guest 页面：安装导航 allowlist（幂等）。
 * 由渲染层在 webview dom-ready 后调用；返回当前页面信息用于状态展示。
 */
export function attachTelegramPage(webContentsId: number): { attached: boolean, url: string } {
  const guest = resolveTelegramGuest(webContentsId)
  if (!guest) throw new Error('页面内核不存在、已销毁，或不属于 telegram-cache 分区')

  if (attachedPageId === guest.id) {
    return { attached: true, url: guest.getURL() || '' }
  }
  releasePageHandlers()
  attachedPageId = guest.id

  const onWillNavigate = (event: Electron.Event, url: string) => {
    if (isAllowedNavigation(url)) return
    event.preventDefault()
    openExternalSafely(url)
  }
  const onWillRedirect = (event: Electron.Event, url: string) => {
    if (isAllowedNavigation(url)) return
    event.preventDefault()
    openExternalSafely(url)
  }
  const onDestroyed = () => releasePageHandlers()

  guest.on('will-navigate', onWillNavigate)
  guest.on('will-redirect', onWillRedirect)
  guest.once('destroyed', onDestroyed)
  // 新窗口一律不创建（会继承父页面安全配置），允许的 http(s) 交给系统浏览器
  guest.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })

  attachedCleanup.push(
    () => guest.removeListener('will-navigate', onWillNavigate),
    () => guest.removeListener('will-redirect', onWillRedirect),
    () => guest.removeListener('destroyed', onDestroyed),
    () => guest.setWindowOpenHandler(() => ({ action: 'deny' })),
  )

  logger.info('Telegram page attached', { webContentsId: guest.id })
  return { attached: true, url: guest.getURL() || '' }
}

function isAllowedNavigation(rawUrl: string): boolean {
  if (rawUrl === 'about:blank' || rawUrl === '') return true
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return isAllowedTelegramHost(url.host)
  } catch {
    return false
  }
}

export function detachTelegramPage(): void {
  releasePageHandlers()
}

export function getAttachedPageId(): number | null {
  return attachedPageId
}

/** 最近一次只读探测结果（M3 可行性报告复用；不额外执行探测） */
let lastProbe: TelegramPageProbe | null = null
export function getLastProbe(): TelegramPageProbe | null {
  return lastProbe
}

// 固定探测脚本：只读 performance / DOM 线索，不做任何写操作。
// 返回值必须全部是原始值（对象也只会被逐字段强转），页面无法借返回对象注入行为。
const PROBE_SCRIPT = `(() => {
  try {
    const perf = performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
    let transferSize = 0;
    let decodedBodySize = 0;
    let blobUrlCount = 0;
    const initiatorTypes = {};
    for (const entry of perf) {
      transferSize += Number(entry.transferSize) || 0;
      decodedBodySize += Number(entry.decodedBodySize) || 0;
      const name = String(entry.name || '');
      if (name.startsWith('blob:')) blobUrlCount += 1;
      const kind = String(entry.initiatorType || 'other').slice(0, 24);
      initiatorTypes[kind] = (initiatorTypes[kind] || 0) + 1;
    }
    const media = document.querySelectorAll('video, audio');
    let videoCount = 0;
    let audioCount = 0;
    for (const element of media) {
      if (element.tagName === 'VIDEO') videoCount += 1;
      else if (element.tagName === 'AUDIO') audioCount += 1;
    }
    return {
      url: String(location.href || ''),
      title: String(document.title || '').slice(0, 200),
      userAgent: String(navigator.userAgent || '').slice(0, 240),
      visible: document.visibilityState === 'visible',
      videoCount,
      audioCount,
      mediaElementCount: media.length,
      blobUrlCount,
      serviceWorkerActive: Boolean(navigator.serviceWorker && navigator.serviceWorker.controller),
      storageEstimateSupported: Boolean(navigator.storage && typeof navigator.storage.estimate === 'function'),
      performance: {
        resources: perf.length,
        transferSize,
        decodedBodySize,
        initiatorTypes,
      },
    };
  } catch (error) {
    return { error: String(error && error.message ? error.message : error).slice(0, 300) };
  }
})()`

function toCount(value: unknown): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return 0
  return Math.floor(num)
}

function toStringSafe(value: unknown, max = 200): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, max)
}

function toInitiatorTypes(value: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (typeof value !== 'object' || value === null) return out
  for (const [key, count] of Object.entries(value as Record<string, unknown>).slice(0, 12)) {
    if (!/^[\w-]{1,24}$/.test(key)) continue
    out[key] = toCount(count)
  }
  return out
}

function buildFindings(probe: Omit<TelegramPageProbe, 'findings'>): string[] {
  const findings: string[] = []
  if (probe.blobUrlCount > 0) {
    findings.push(`页面已产生 ${probe.blobUrlCount} 条 blob: 资源：这类媒体由页面自行拼装，主进程拿不到可复用地址，不能当作归档数据源。`)
  }
  if (probe.serviceWorkerActive) {
    findings.push('页面存在活动 Service Worker：其发起的请求可能没有 webContents 归属，属于 webRequest 观测的盲区。')
  }
  if (probe.mediaElementCount > 0) {
    findings.push(`检测到 ${probe.mediaElementCount} 个媒体元素（video ${probe.videoCount} / audio ${probe.audioCount}）：播放中的数据是否可复用需要单独验证，本版本不捕获播放中的数据。`)
  }
  if (probe.performance.resources > 0 && probe.performance.transferSize === 0) {
    findings.push('performance 的 transferSize 为 0：跨域资源大小在页面侧不可见，只能依赖 webRequest 的响应头统计。')
  }
  const websocketHint = probe.performance.initiatorTypes.other ?? 0
  if (websocketHint > 0) {
    findings.push('performance 里有 other 类型资源：Telegram 的 MTProto / 长连接流量可能不经过普通 HTTP 路径，需要结合请求类型分布判断。')
  }
  if (!findings.length) findings.push('未发现 blob / Service Worker / 媒体元素线索：目标页面可能刚打开，或媒体走 MTProto 长连接。')
  return findings
}

/** 在 guest 页面执行只读探测；任何异常都以 ok:false 返回，不向渲染层抛内部错误 */
async function runTelegramProbe(webContentsId: number): Promise<TelegramPageProbe> {
  const probeBase = {
    probedAt: Date.now(),
    url: '',
    title: '',
    userAgent: '',
    visible: false,
    videoCount: 0,
    audioCount: 0,
    mediaElementCount: 0,
    blobUrlCount: 0,
    serviceWorkerActive: false,
    storageEstimateSupported: false,
    performance: { resources: 0, transferSize: 0, decodedBodySize: 0, initiatorTypes: {} },
  }
  let guest: WebContents | null
  try {
    guest = resolveTelegramGuest(webContentsId)
  } catch {
    guest = null
  }
  if (!guest) {
    return {
      ...probeBase,
      ok: false,
      findings: [],
      error: '页面内核不存在、已销毁，或不属于 telegram-cache 分区',
    }
  }

  let raw: unknown
  try {
    raw = await guest.executeJavaScript(PROBE_SCRIPT, false)
  } catch (error) {
    return {
      ...probeBase,
      ok: false,
      findings: [],
      error: `探测脚本执行失败：${(error as Error).message}`,
    }
  }

  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const errorText = toStringSafe(record.error, 300)
  if (errorText) {
    return { ...probeBase, ok: false, findings: [], error: errorText }
  }

  const performanceRaw = (typeof record.performance === 'object' && record.performance !== null
    ? record.performance
    : {}) as Record<string, unknown>

  const probeWithoutFindings: Omit<TelegramPageProbe, 'findings'> = {
    ok: true,
    probedAt: probeBase.probedAt,
    url: describeUrl(toStringSafe(record.url, 2000))?.displayUrl ?? '',
    title: toStringSafe(record.title),
    userAgent: toStringSafe(record.userAgent, 240),
    visible: record.visible === true,
    videoCount: toCount(record.videoCount),
    audioCount: toCount(record.audioCount),
    mediaElementCount: toCount(record.mediaElementCount),
    blobUrlCount: toCount(record.blobUrlCount),
    serviceWorkerActive: record.serviceWorkerActive === true,
    storageEstimateSupported: record.storageEstimateSupported === true,
    performance: {
      resources: toCount(performanceRaw.resources),
      transferSize: toCount(performanceRaw.transferSize),
      decodedBodySize: toCount(performanceRaw.decodedBodySize),
      initiatorTypes: toInitiatorTypes(performanceRaw.initiatorTypes),
    },
  }

  return { ...probeWithoutFindings, findings: buildFindings(probeWithoutFindings) }
}

/** 对外入口：记录最近一次探测结果（M3 报告复用），异常路径也记录 */
export async function probeTelegramPage(webContentsId: number): Promise<TelegramPageProbe> {
  const result = await runTelegramProbe(webContentsId)
  lastProbe = result
  return result
}
