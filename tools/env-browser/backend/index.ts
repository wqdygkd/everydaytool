import { registerEnvBrowserHandlers } from './ipc/handlers.js'

export const envBrowserBackend = {
  async initialize(): Promise<void> {
    registerEnvBrowserHandlers()
  },
}
