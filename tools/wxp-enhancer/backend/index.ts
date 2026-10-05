import { registerWxpHandlers } from './ipc/handlers.js'
import { wxpService } from './services/wxp-service.js'

export const wxpEnhancerBackend = {
  initialize(): void {
    registerWxpHandlers()
  },

  async dispose(): Promise<void> {
    await wxpService.stop()
  },
}
