import { registerTreeaseHandlers } from './ipc/handlers.ts'
import { installCacheHandlers, interceptService } from './services/intercept-service.ts'

export const treeaseEditorBackend = {
  initialize(): void {
    // sessionData 已在 main 的 ready 之前指向数据目录，分区缓存会物理落在
    // <data-root>/session/Partitions/treease-editor，无需在此做链接/迁移。
    registerTreeaseHandlers()
    // 预装协议层 handler：首个 webview 导航前即接管，页面缓存不依赖拦截是否启动
    installCacheHandlers()
  },

  async dispose(): Promise<void> {
    await interceptService.stopAll()
  },
}
