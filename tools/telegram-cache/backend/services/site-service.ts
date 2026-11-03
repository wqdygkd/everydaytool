// 自托管 telegram-tt 的站点生命周期（v4）：启动/停止 loopback 服务，并把状态暴露给快照与 IPC。
//
// 约束：
// - 只认仓库内的 telegram-tt/dist（开发/自用形态）；打包产物没有它时明确报错，不回退远程站点；
// - 站点与 /api、/media 同源，页面通过 /edt-bootstrap.js 拿到 token；
// - 导航闸只额外放行这个 origin，其它域名仍交给系统浏览器。
import type { TelegramSiteInfo } from '../../../../shared/telegram-cache.ts'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { app } from 'electron'
import { logger } from '../../../../backend/utils/logger.ts'
import { TELEGRAM_SITE_PORT_BASE, TELEGRAM_SITE_PORT_RANGE } from '../../../../shared/telegram-cache.ts'
import { getTelegramCacheConfig, updateTelegramCacheConfig } from '../store/config-store.ts'
import { handleTelegramArchiveApi } from './archive-api.ts'
import { getTelegramMediaStatuses, resolveTelegramMedia } from './media-resolver.ts'
import { setTelegramLocalOrigin } from './probe-service.ts'
import { getTelegramSiteServerInfo, startTelegramSiteServer, stopTelegramSiteServer } from './site-server.ts'

const EMPTY_SITE: TelegramSiteInfo = {
  ready: false,
  url: null,
  port: null,
  previousPort: null,
  originChanged: false,
  portNote: null,
  error: null,
}

let siteStatus: TelegramSiteInfo = { ...EMPTY_SITE }

function resolveSiteRoot(): string {
  // 开发/自用：app.getAppPath() 是仓库根；安装版没有 telegram-tt/dist，会走错误分支。
  return path.join(app.getAppPath(), 'telegram-tt', 'dist')
}

export function getTelegramSiteStatus(): TelegramSiteInfo {
  const info = getTelegramSiteServerInfo()
  if (info) return { ...siteStatus, ready: true, url: info.url, port: info.port, error: null }
  return { ...siteStatus }
}

export async function initializeTelegramSite(): Promise<void> {
  const rootDir = resolveSiteRoot()
  const indexPath = path.join(rootDir, 'index.html')
  if (!existsSync(indexPath)) {
    siteStatus = {
      ...EMPTY_SITE,
      error: `未找到 telegram-tt 构建产物（${path.relative(process.cwd(), indexPath)}）：先运行 pnpm telegram:build`,
    }
    logger.warn('Telegram site server not started: dist missing', { rootDir })
    return
  }

  // 端口必须确定：origin 一变，页面侧的登录态（localStorage）、IndexedDB、Cache Storage 与
  // Service Worker 注册就全部作废，用户等于重新登录 + 缓存全丢（见 TelegramSiteInfo.originChanged）。
  const configuredPort = getTelegramCacheConfig().sitePort
  const basePort = configuredPort ?? TELEGRAM_SITE_PORT_BASE

  try {
    const info = await startTelegramSiteServer({
      rootDir,
      apiVersion: app.getVersion(),
      port: basePort,
      portRange: TELEGRAM_SITE_PORT_RANGE,
      resolveMedia: resolveTelegramMedia,
      getMediaStatus: getTelegramMediaStatuses,
      handleApi: handleTelegramArchiveApi,
    })
    // 落盘实际端口：下次启动从它起步，正常路径下 origin 再不变化（首次分配不提示 origin 变化）。
    if (info.port !== configuredPort) {
      updateTelegramCacheConfig({ sitePort: info.port })
      logger.info('Telegram site port persisted', { port: info.port, previousPort: configuredPort })
    }
    const originChanged = configuredPort !== null && configuredPort !== info.port
    siteStatus = {
      ready: true,
      url: info.url,
      port: info.port,
      previousPort: configuredPort,
      originChanged,
      portNote: originChanged
        ? `端口 ${configuredPort} 被占用，已改用 ${info.port}：origin 变化会清空页面登录态与本地缓存，请重新登录`
        : null,
      error: null,
    }
    setTelegramLocalOrigin(info.url)
    logger.info('Telegram site server ready', { url: info.url })
  } catch (error) {
    const message = (error as Error).message
    siteStatus = { ...EMPTY_SITE, previousPort: configuredPort, error: message }
    logger.warn('Telegram site server failed to start', {
      error: message,
      basePort,
      range: TELEGRAM_SITE_PORT_RANGE,
    })
  }
}

export function disposeTelegramSite(): void {
  if (getTelegramSiteServerInfo()) logger.info('Telegram site server stopped')
  stopTelegramSiteServer()
  setTelegramLocalOrigin(null)
  siteStatus = { ...EMPTY_SITE }
}
