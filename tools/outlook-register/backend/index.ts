import { logger } from '../../../backend/utils/logger.ts'
import { registerOutlookRegisterHandlers } from './ipc/handlers.ts'
import { applyOutlookSettingsToAllSessions } from './services/outlook-session.ts'

export const outlookRegisterBackend = {
  initialize(): void {
    registerOutlookRegisterHandlers()
    // 应用重启后，已存在的邮箱 webview 不会再触发 prepare；
    // 在启动阶段先铺一遍 UA 与代理，避免收件箱以 Electron UA 首刷被 Microsoft 拦截。
    void applyOutlookSettingsToAllSessions().catch((error) => {
      logger.warn('Failed to apply Outlook session settings at startup', {
        error: (error as Error).message,
      })
    })
  },
}
