import { registerOfflinePackHandlers } from './ipc/handlers.ts'
import { cancelAllDownloads, sweepOfflinePackTempFiles } from './utils/downloads.ts'

export const offlinePackBackend = {
  initialize(): void {
    registerOfflinePackHandlers()
    void sweepOfflinePackTempFiles().catch(() => undefined)
  },
  dispose(): void {
    cancelAllDownloads()
  },
}
