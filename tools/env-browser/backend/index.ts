import { registerEnvBrowserHandlers } from './ipc/handlers.js'
import { closeEnvDatabase } from './store/env-store.js'

export const envBrowserBackend = {
  async initialize(): Promise<void> {
    registerEnvBrowserHandlers()
  },

  onDataDirectoryChanged(): void {
    // 数据根目录变更后丢弃缓存的数据库连接，下次访问按新目录重开
    closeEnvDatabase()
  },
}
