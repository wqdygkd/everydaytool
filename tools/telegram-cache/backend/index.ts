// telegram-cache 后端入口：
// - initialize：先读数据目录覆盖配置（保证后续路径都落在用户选择的目录），
//   装好 webview 域名导航闸、注册 IPC 与归档引擎；
// - runtime-service：页面挂载时才启动本地站点与快照推送，页面卸载立即销毁；
// - dispose：停推送 → 解绑页面 → 取消任务，顺序保证退出时不再产生新事件。
// 说明：观测（webRequest / 资源库 / 基准测试）相关界面已在 1.8.0 移除，这里不再挂载 observer，
// 对应服务文件保留以备将来重新接线，但不产生任何运行时开销。
import { registerCacheIntegrityHandler } from '../../../backend/utils/data-root-scan.ts'
import { loadDataDirectoryOverride } from '../../../backend/utils/data-root.ts'
import { logger } from '../../../backend/utils/logger.ts'
import { registerTelegramCacheHandlers } from './ipc/handlers.ts'
import { registerArchiveEngine } from './services/archive-engine.ts'
import { installTelegramGuestGuards } from './services/probe-service.ts'
import { deactivateTelegramCacheRuntime } from './services/runtime-service.ts'
import { pruneTelegramRegistry } from './store/resource-registry.ts'
import { relocateSecureSessionFile } from './utils/session-store.ts'

export const telegramCacheBackend = {
  async initialize(): Promise<void> {
    try {
      await loadDataDirectoryOverride()
    } catch (error) {
      logger.warn('Telegram cache data directory load failed', { error: (error as Error).message })
    }

    // MTProto 加密会话跟随数据目录（会迁移早期 userData 中的密文）
    relocateSecureSessionFile()

    // 域名级导航 allowlist 在 webview 创建时装好（不等渲染层 dom-ready 后调 PAGE_ATTACH）
    installTelegramGuestGuards()

    registerTelegramCacheHandlers()
    // 把归档存储暴露给平台层：tweb-cache 工具复用同一份数据，但各有独立站点与 IPC
    registerArchiveEngine()

    // 清缓存会删掉 objects/：索引必须跟着修剪，否则会把「只剩一条记录」当成可复用内容
    registerCacheIntegrityHandler(() => {
      pruneTelegramRegistry()
    })
  },

  async dispose(): Promise<void> {
    await deactivateTelegramCacheRuntime()
  },
}
