import { registerWxpCommands } from './commands/handlers.ts'
import { wxpService } from './services/wxp-service.ts'

export const wxpEnhancerService = {
  initialize(): void {
    registerWxpCommands()
  },

  async dispose(): Promise<void> {
    await wxpService.stop()
  },
}
