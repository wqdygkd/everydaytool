import { registerEnvBrowserCommands } from './commands/handlers.ts'
import { resetEnvStore } from './store/env-store.ts'

export const envBrowserService = {
  async initialize(): Promise<void> {
    registerEnvBrowserCommands()
  },

  onDataDirectoryChanged(): void {
    // 数据根目录变更后丢弃 JSON 存储缓存，下次访问按新目录重读
    resetEnvStore()
  },
}
