import { registerOfflinePackHandlers } from './ipc/handlers.ts'

export const offlinePackBackend = {
  initialize(): void {
    registerOfflinePackHandlers()
  },
}
