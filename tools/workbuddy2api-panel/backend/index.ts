import { registerCacheIntegrityHandler } from '../../../backend/utils/data-root-scan.ts'
import { logger } from '../../../backend/utils/logger.ts'
import { registerWb2apiPanelHandlers } from './ipc/handlers.ts'
import { installWb2apiGuestGuards } from './services/guest-guards.ts'
import { stopManagedProcess } from './services/process-service.ts'
import { publishStateNow, stopStatePublisher } from './services/state-service.ts'

export const workbuddy2apiPanelBackend = {
  initialize(): void {
    installWb2apiGuestGuards()
    registerWb2apiPanelHandlers()

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
