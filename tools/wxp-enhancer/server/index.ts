import { registerWxpCommands } from './commands/handlers.ts'
import { wxpService } from './services/wxp-service.ts'
import { resetWxpConfigStore } from './store/config-store.ts'
import { resetDataCacheStore } from './store/data-cache-store.ts'

export const wxpEnhancerService = {
  initialize(): void {
    registerWxpCommands()
  },

  onDataDirectoryChanged(): void {
    // 数据根目录变更后丢弃 JSON 存储缓存，下次访问按新目录重读
    resetWxpConfigStore()
    resetDataCacheStore()
  },

  async dispose(): Promise<void> {
    await wxpService.stop()
  },
}
