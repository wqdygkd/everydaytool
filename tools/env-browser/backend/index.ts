import { registerEnvBrowserHandlers } from './ipc/handlers.ts'
import { closeEnvDatabase } from './store/env-store.ts'

export const envBrowserBackend = {
  async initialize(): Promise<void> {
    registerEnvBrowserHandlers()
  },

  onDataDirectoryChanged(): void {
    // 数据根目录变更后丢弃缓存的数据库连接，下次访问按新目录重开
    closeEnvDatabase()
  },

  dispose(): void {
    // 退出时关闭连接（WAL checkpoint），否则进程退出后可能残留 -wal 文件
    closeEnvDatabase()
  },
}
