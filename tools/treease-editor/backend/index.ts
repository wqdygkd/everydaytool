import { registerTreeaseHandlers } from './ipc/handlers.js'
import { installCacheHandlers, interceptService } from './services/intercept-service.js'

export const treeaseEditorBackend = {
  initialize(): void {
    registerTreeaseHandlers()
    // 预装协议层 handler：首个 webview 导航前即接管，页面缓存不依赖拦截是否启动
    installCacheHandlers()
  },

  async dispose(): Promise<void> {
    await interceptService.stopAll()
  },
}
