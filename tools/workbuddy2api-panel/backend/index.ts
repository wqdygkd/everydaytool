import { registerCacheIntegrityHandler } from '../../../backend/utils/data-root-scan.ts'
import { loadDataDirectoryOverride } from '../../../backend/utils/data-root.ts'
import { logger } from '../../../backend/utils/logger.ts'
import { registerWb2apiPanelHandlers } from './ipc/handlers.ts'
import { installWb2apiGuestGuards } from './services/guest-guards.ts'
import { stopManagedProcess } from './services/process-service.ts'
import { publishStateNow, startStatePublisher, stopStatePublisher } from './services/state-service.ts'
import { ensureWb2apiDirs } from './utils/paths.ts'

export const workbuddy2apiPanelBackend = {
  async initialize(): Promise<void> {
    try {
      await loadDataDirectoryOverride()
    } catch (error) {
      logger.warn('wb2api data directory load failed', { error: (error as Error).message })
    }
    try {
      await ensureWb2apiDirs()
    } catch (error) {
      logger.warn('wb2api ensure dirs failed', { error: (error as Error).message })
    }
    installWb2apiGuestGuards()
    registerWb2apiPanelHandlers()
    // 运行中定时探活推送（加账号后 health 会变）；默认仍不自动 start
    startStatePublisher()

    // 清缓存会删掉 runtime/ 里的二进制：manifest 还在，但「已安装」必须重算（= 二进制真的存在）
    registerCacheIntegrityHandler(async () => {
      await publishStateNow()
    })
  },

  async dispose(): Promise<void> {
    stopStatePublisher()
    // before-quit 与关页签共用 STOP
    try {
      await stopManagedProcess()
    } catch (error) {
      logger.warn('wb2api stop on dispose failed', { error: (error as Error).message })
    }
  },
}
