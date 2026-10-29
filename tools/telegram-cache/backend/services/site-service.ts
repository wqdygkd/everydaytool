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
import { handleTelegramArchiveApi } from './archive-api.ts'
import { getTelegramMediaStatuses, resolveTelegramMedia } from './media-resolver.ts'
import { setTelegramLocalOrigin } from './probe-service.ts'
import { getTelegramSiteServerInfo, startTelegramSiteServer, stopTelegramSiteServer } from './site-server.ts'

const EMPTY_SITE: TelegramSiteInfo = { ready: false, url: null, error: null }

let siteStatus: TelegramSiteInfo = { ...EMPTY_SITE }

function resolveSiteRoot(): string {
  // 开发/自用：app.getAppPath() 是仓库根；安装版没有 telegram-tt/dist，会走错误分支。
  return path.join(app.getAppPath(), 'telegram-tt', 'dist')
}

export function getTelegramSiteStatus(): TelegramSiteInfo {
  const info = getTelegramSiteServerInfo()
  if (info) return { ready: true, url: info.url, error: null }
  return { ...siteStatus }
}

export async function initializeTelegramSite(): Promise<void> {
  const rootDir = resolveSiteRoot()
  const indexPath = path.join(rootDir, 'index.html')
  if (!existsSync(indexPath)) {
    siteStatus = {
      ready: false,
      url: null,
      error: `未找到 telegram-tt 构建产物（${path.relative(process.cwd(), indexPath)}）：先运行 pnpm telegram:build`,
    }
    logger.warn('Telegram site server not started: dist missing', { rootDir })
    return
  }

  try {
    const info = await startTelegramSiteServer({
      rootDir,
      apiVersion: app.getVersion(),
      resolveMedia: resolveTelegramMedia,
      getMediaStatus: getTelegramMediaStatuses,
      handleApi: handleTelegramArchiveApi,
    })
    siteStatus = { ready: true, url: info.url, error: null }
    setTelegramLocalOrigin(info.url)
    logger.info('Telegram site server ready', { url: info.url })
  } catch (error) {
    siteStatus = { ready: false, url: null, error: (error as Error).message }
    logger.warn('Telegram site server failed to start', { error: (error as Error).message })
  }
}

export function disposeTelegramSite(): void {
  stopTelegramSiteServer()
  setTelegramLocalOrigin(null)
  siteStatus = { ...EMPTY_SITE }
}
