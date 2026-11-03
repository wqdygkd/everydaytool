// interceptor 工具域后端入口（electron/tool-registry.ts 注册）。
// 应用启动只注册窄 IPC；WS 桥与 MITM 代理由工具页挂载时经 RUNTIME_START 拉起，
// 页面卸载 / 关闭页签时经 RUNTIME_STOP 立即停止。
import { registerInterceptorHandlers } from './ipc/handlers.ts'
import { interceptorService } from './services/interceptor-service.ts'

export const interceptorBackend = {
  initialize(): void {
    registerInterceptorHandlers()
  },

  async dispose(): Promise<void> {
    await interceptorService.dispose()
  },
}
