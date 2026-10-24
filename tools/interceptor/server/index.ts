// interceptor 工具域后端入口。
// edt 启动即拉起 WS 桥与 MITM 代理：edt 不开则代理全停（方案固有形态，见设计文档 §8）。
import { registerInterceptorCommands } from './commands/handlers.ts'
import { interceptorService } from './services/interceptor-service.ts'

export const interceptorToolService = {
  async initialize(): Promise<void> {
    await interceptorService.initialize()
    registerInterceptorCommands()
  },

  onDataDirectoryChanged(): void {
    interceptorService.onDataDirectoryChanged()
  },

  async dispose(): Promise<void> {
    await interceptorService.dispose()
  },
}
