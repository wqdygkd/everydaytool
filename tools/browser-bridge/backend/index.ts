// browser-bridge 工具域后端入口（electron/tool-registry.ts 注册）。
// edt 启动即拉起 WS 桥与 MITM 代理：edt 不开则代理全停（方案固有形态，见设计文档 §8）。
import { registerBrowserBridgeHandlers } from './ipc/handlers.ts'
import { browserBridgeService } from './services/bridge-service.ts'

export const browserBridgeBackend = {
  async initialize(): Promise<void> {
    await browserBridgeService.initialize()
    registerBrowserBridgeHandlers()
  },

  onDataDirectoryChanged(): void {
    browserBridgeService.onDataDirectoryChanged()
  },

  async dispose(): Promise<void> {
    await browserBridgeService.dispose()
  },
}
