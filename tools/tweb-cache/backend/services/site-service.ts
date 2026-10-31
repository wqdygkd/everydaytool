// tweb-cache 的站点生命周期：把 `tweb/dist`（+ `tweb/public`）托管在**本工具专属的回环端口**上。
//
// 与 telegram-cache 的关系：站点实现与归档 API 由平台层的归档引擎提供
// （`backend/telegram-archive/engine.ts`，由 telegram-cache 后端注册），
// 本工具只决定「托管哪个目录、用哪个端口、状态怎么展示」——因此两个工具
// 各有独立 origin / 配置 / IPC / 数据命名空间，只共享归档实现。
import type { TwebCacheSiteInfo } from '../../../../shared/tweb-cache.ts'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { app } from 'electron'
import { getTelegramArchiveEngine, hasTelegramArchiveEngine } from '../../../../backend/telegram-archive/engine.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { TWEB_CACHE_SITE_PORT_BASE, TWEB_CACHE_SITE_PORT_RANGE } from '../../../../shared/tweb-cache.ts'
import { getTwebCacheConfig, updateTwebCacheConfig } from '../store/config-store.ts'

const EMPTY_SITE: TwebCacheSiteInfo = {
  ready: false,
  url: null,
  port: null,
  previousPort: null,
  originChanged: false,
  portNote: null,
  error: null,
}

let siteStatus: TwebCacheSiteInfo = { ...EMPTY_SITE }
let siteHandle: { url: string, port: number, token: string, stop: () => void } | null = null
/** 打开的 tweb-cache 页签数：>0 时站点保持运行，归零后闲置停站点 */
let siteRefCount = 0
let idleStopTimer: NodeJS.Timeout | undefined

/** 站点闲置停机延迟：最后一个页签关闭后等这段时间再停，避免快速重开时反复换端口 */
const SITE_IDLE_STOP_DELAY_MS = 5 * 60 * 1000

function resolveSiteRoot(): string {
  return path.join(app.getAppPath(), 'tweb', 'dist')
}

/** tweb 的 dist 只有 chunk，assets / wasm / 字体在 public/ 里 —— 两层都要托管 */
function resolveSiteExtraRoot(): string {
  return path.join(app.getAppPath(), 'tweb', 'public')
}

export function getTwebCacheSiteStatus(): TwebCacheSiteInfo {
  return siteHandle ? { ...siteStatus, ready: true, url: siteHandle.url, port: siteHandle.port, error: null } : { ...siteStatus }
}

/** 影库缩略图 URL 拼接用；token 不进渲染层状态，只拼一次性媒体地址 */
export function getTwebCacheMediaOrigin(): { url: string, token: string } | undefined {
  return siteHandle ? { url: siteHandle.url, token: siteHandle.token } : undefined
}

export async function initializeTwebCacheSite(): Promise<void> {
  siteStatus = { ...EMPTY_SITE }
}

/** 懒启动入口：页签打开时才真正拉起站点；幂等，重复调用只增加引用计数 */
export async function ensureTwebCacheSiteStarted(): Promise<TwebCacheSiteInfo> {
  cancelIdleStopTimer()
  siteRefCount++
  if (siteHandle) return getTwebCacheSiteStatus()
  await startSite()
  return getTwebCacheSiteStatus()
}

/** 页签卸载时释放引用；归零后延迟停站点（快速重开不重启） */
export function releaseTwebCacheSite(): void {
  siteRefCount = Math.max(0, siteRefCount - 1)
  if (siteRefCount > 0 || !siteHandle) return
  cancelIdleStopTimer()
  idleStopTimer = setTimeout(() => {
    idleStopTimer = undefined
    stopSite('idle')
  }, SITE_IDLE_STOP_DELAY_MS)
  idleStopTimer.unref()
}

function cancelIdleStopTimer(): void {
  if (idleStopTimer !== undefined) {
    clearTimeout(idleStopTimer)
    idleStopTimer = undefined
  }
}

function stopSite(reason: 'idle' | 'dispose'): void {
  const wasRunning = siteHandle !== null
  siteHandle?.stop()
  siteHandle = null
  siteStatus = { ...EMPTY_SITE }
  if (reason === 'dispose') siteRefCount = 0
  if (wasRunning) logger.info('tweb site server stopped', { reason })
}

async function startSite(): Promise<void> {
  const rootDir = resolveSiteRoot()
  const indexPath = path.join(rootDir, 'index.html')
  if (!existsSync(indexPath)) {
    siteStatus = {
      ...EMPTY_SITE,
      error: `未找到 tweb 构建产物（${path.relative(process.cwd(), indexPath)}）：在仓库根运行 pnpm tweb:build`,
    }
    logger.warn('tweb site server not started: dist missing', { rootDir })
    return
  }

  if (!hasTelegramArchiveEngine()) {
    siteStatus = { ...EMPTY_SITE, error: '归档引擎未就绪（telegram-cache 后端应先初始化）' }
    logger.warn('tweb site server not started: archive engine missing')
    return
  }

  // 端口落盘后固定：origin 变一次，tweb 的登录态（IndexedDB / localStorage / SW）就全作废
  const configuredPort = getTwebCacheConfig().sitePort
  const basePort = configuredPort ?? TWEB_CACHE_SITE_PORT_BASE

  try {
    const handle = await getTelegramArchiveEngine().startSite('tweb-cache', {
      rootDir,
      extraRootDir: resolveSiteExtraRoot(),
      port: basePort,
      portRange: TWEB_CACHE_SITE_PORT_RANGE,
      apiVersion: app.getVersion(),
    })
    siteHandle = handle
    if (handle.port !== configuredPort) {
      updateTwebCacheConfig({ sitePort: handle.port })
      logger.info('tweb site port persisted', { port: handle.port, previousPort: configuredPort })
    }
    const originChanged = configuredPort !== null && configuredPort !== handle.port
    siteStatus = {
      ready: true,
      url: handle.url,
      port: handle.port,
      previousPort: configuredPort,
      originChanged,
      portNote: originChanged
        ? `端口 ${configuredPort} 被占用，已改用 ${handle.port}：origin 变化会清空 tweb 的登录态，请重新登录`
        : null,
      error: null,
    }
    logger.info('tweb site server ready', { url: handle.url })
  } catch (error) {
    const message = (error as Error).message
    siteStatus = { ...EMPTY_SITE, previousPort: configuredPort, error: message }
    logger.warn('tweb site server failed to start', { error: message, basePort, range: TWEB_CACHE_SITE_PORT_RANGE })
  }
}

export function disposeTwebCacheSite(): void {
  cancelIdleStopTimer()
  stopSite('dispose')
}
