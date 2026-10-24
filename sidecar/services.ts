// Node 业务服务编排：
// disposeServices 完全同序（单工具失败不拖垮其它工具）。
// treease-editor 在阶段 5 迁移完成后接入（它的拦截逻辑改为 Tauri 子 Webview 注入实现）。
import { registerAppCommands } from '../server/commands/handlers.ts'
import { logger } from '../server/utils/logger.ts'
import { chromeSandboxService } from '../tools/chrome-sandbox/server/index.ts'
import { envBrowserService } from '../tools/env-browser/server/index.ts'
import { interceptorToolService } from '../tools/interceptor/server/index.ts'
import { offlinePackService } from '../tools/offline-pack/server/index.ts'
import { wxpEnhancerService } from '../tools/wxp-enhancer/server/index.ts'

export interface ToolService {
  initialize: () => Promise<void> | void
  dispose?: () => Promise<void> | void
  onDataDirectoryChanged?: () => Promise<void> | void
}

export const toolServices: ToolService[] = [
  interceptorToolService,
  chromeSandboxService,
  envBrowserService,
  wxpEnhancerService,
  offlinePackService,
]

let initialized = false

export async function initializeServices(): Promise<void> {
  if (initialized) return
  initialized = true

  // 应用壳 commands：数据目录 / 磁盘用量 / 缓存清理 / DevTools（窗口外观由 Rust 原生处理）
  registerAppCommands({ notifyDataDirectoryChanged })

  for (const backend of toolServices) {
    try {
      await backend.initialize()
    } catch (error) {
      // 单工具初始化失败（如端口段耗尽）不拖垮其它工具：记错继续
      logger.error('Tool service initialize failed', { error: (error as Error).message })
    }
  }
}

export async function disposeServices(): Promise<void> {
  for (const backend of [...toolServices].reverse()) {
    try {
      await backend.dispose?.()
    } catch (error) {
      logger.error('Tool service dispose failed', { error: (error as Error).message })
    }
  }
}

/** 数据根目录变更后依次通知各工具域重载（应用壳 commands 注入调用） */
export async function notifyDataDirectoryChanged(): Promise<void> {
  for (const backend of toolServices) {
    await backend.onDataDirectoryChanged?.()
  }
}
