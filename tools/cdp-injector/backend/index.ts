import { registerCdpInjectorHandlers } from './ipc/handlers.js'
import { injectorService } from './services/injector-service.js'

export const cdpInjectorBackend = {
  initialize(): void {
    registerCdpInjectorHandlers()
  },

  async dispose(): Promise<void> {
    await injectorService.stopAll()
  },
}
