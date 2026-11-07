// tweb-cache 的站点生命周期：把 `tweb/dist`（+ `tweb/public`）托管在**本工具专属的回环端口**上。
// 站点实现与归档 API 由本工具后端的 archive/ 目录提供。
import type { TwebCacheSiteInfo } from '../../../../shared/tweb-cache.ts'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { app } from 'electron'
import { logger } from '../../../../backend/utils/logger.ts'
import { TWEB_CACHE_SITE_PORT_BASE, TWEB_CACHE_SITE_PORT_RANGE } from '../../../../shared/tweb-cache.ts'
import { startArchiveSite } from '../archive/index.ts'
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
let lifecycleQueue: Promise<void> = Promise.resolve()

function enqueueLifecycle<T>(task: () => Promise<T>): Promise<T> {
  const run = lifecycleQueue.then(task, task)
  lifecycleQueue = run.then(() => undefined, () => undefined)
  return run
}

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
  return enqueueLifecycle(async () => {
    siteRefCount++
    if (!siteHandle) await startSite()
    return getTwebCacheSiteStatus()
  })
}

/** 页签卸载时释放引用；归零即停站点，关闭工具不保留后台服务 */
export function releaseTwebCacheSite(): Promise<void> {
  return enqueueLifecycle(async () => {
    siteRefCount = Math.max(0, siteRefCount - 1)
    if (siteRefCount === 0 && siteHandle) stopSite('idle')
  })
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

  // 端口落盘后固定：origin 变一次，tweb 的登录态（IndexedDB / localStorage / SW）就全作废
  const configuredPort = getTwebCacheConfig().sitePort
  const basePort = configuredPort ?? TWEB_CACHE_SITE_PORT_BASE

  try {
    const handle = await startArchiveSite({
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
  stopSite('dispose')
}
