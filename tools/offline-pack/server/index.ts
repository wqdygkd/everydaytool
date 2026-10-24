import { registerOfflinePackCommands } from './commands/handlers.ts'
import { resetHistoryStore } from './utils/history.ts'

export const offlinePackService = {
  initialize(): void {
    registerOfflinePackCommands()
  },

  onDataDirectoryChanged(): void {
    // 数据根目录变更后丢弃 JSON 存储缓存，下次访问按新目录重读
    resetHistoryStore()
  },
}
