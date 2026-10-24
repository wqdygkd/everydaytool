import { registerOfflinePackCommands } from './commands/handlers.ts'

export const offlinePackService = {
  initialize(): void {
    registerOfflinePackCommands()
  },
}
