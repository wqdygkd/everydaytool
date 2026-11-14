// tweb-cache 后端入口：自己的站点、自己的 IPC 命名空间、自己的配置与归档实现。
// 归档数据落在 `<assets>/tweb-cache/...`。
import { registerTwebCacheHandlers } from './ipc/handlers.ts'
import { disposeTwebCacheSite, initializeTwebCacheSite } from './services/site-service.ts'

export const twebCacheBackend = {
  initialize(): void {
    // 站点懒启动：不随 app 启动拉起，首次打开工具页时经 SITE_ACQUIRE 启动
    initializeTwebCacheSite()
    registerTwebCacheHandlers()
  },

  async dispose(): Promise<void> {
    disposeTwebCacheSite()
  },
}
