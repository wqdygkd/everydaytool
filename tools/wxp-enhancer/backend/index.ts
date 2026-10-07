import { registerWxpHandlers } from './ipc/handlers.ts'
import { wxpService } from './services/wxp-service.ts'

export const wxpEnhancerBackend = {
  initialize(): void {
    registerWxpHandlers()
  },

  async dispose(): Promise<void> {
    await wxpService.stop()
  },
}
