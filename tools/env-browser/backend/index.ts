import { registerEnvBrowserHandlers } from './ipc/handlers.ts'

export const envBrowserBackend = {
  async initialize(): Promise<void> {
    registerEnvBrowserHandlers()
  },
}
