// tweb-cache 后端入口：自己的站点、自己的 IPC 命名空间、自己的配置与归档实现。
// 归档数据落在 `<assets>/tweb-cache/...`。
import { loadDataDirectoryOverride } from '../../../backend/utils/data-root.ts'
import { logger } from '../../../backend/utils/logger.ts'
import { registerTwebCacheHandlers } from './ipc/handlers.ts'
import { disposeTwebCacheSite, initializeTwebCacheSite } from './services/site-service.ts'

export const twebCacheBackend = {
  async initialize(): Promise<void> {
    try {
      // 先应用用户选择的数据目录（幂等，重复调用无副作用）
      await loadDataDirectoryOverride()
    } catch (error) {
      logger.warn('tweb-cache data directory load failed', { error: (error as Error).message })
    }

    // 站点懒启动：不随 app 启动拉起，首次打开工具页时经 SITE_ACQUIRE 启动
    await initializeTwebCacheSite()
    registerTwebCacheHandlers()
  },

  async dispose(): Promise<void> {
    disposeTwebCacheSite()
  },
}
