import { registerYunshuUninstallHandlers } from './ipc/handlers.ts'

export const yunshuUninstallBackend = {
  initialize(): void {
    registerYunshuUninstallHandlers()
  },
}
