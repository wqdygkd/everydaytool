// telegram-cache 后端入口：
// - initialize：先读数据目录覆盖配置（与 chrome-sandbox 一致，保证后续路径都落在用户选择的目录），
//   装好 webview 域名导航闸、再挂载 webRequest 观测（都必须在 webview 首次导航前完成）、
//   清理失效索引、注册 IPC、启动快照推送。
// - dispose：停推送 → 解绑页面 → 取消任务 → 卸载观测，顺序保证退出时不再产生新事件。
import { registerCacheIntegrityHandler } from '../../../backend/utils/data-root-scan.ts'
import { loadDataDirectoryOverride } from '../../../backend/utils/data-root.ts'
import { logger } from '../../../backend/utils/logger.ts'
import { registerTelegramCacheHandlers } from './ipc/handlers.ts'
import { disposeBenchmark } from './services/benchmark-service.ts'
import { enforceTelegramCacheQuota } from './services/cache-manager.ts'
import { disposeTelegramTasks } from './services/download-service.ts'
import {
  disposeTelegramLocalResponse,
  syncTelegramLocalResponseWithConfig,
} from './services/local-response-service.ts'
import { disposeMtproto } from './services/mtproto-service.ts'
import {
  attachTelegramObservation,
  detachTelegramObservation,
  setTelegramObservationEnabled,
} from './services/observation-service.ts'
import { disposePageCapture, syncPageCaptureWithConfig } from './services/page-capture-service.ts'
import { detachTelegramPage, installTelegramGuestGuards } from './services/probe-service.ts'
import {
  startTelegramSnapshotPublisher,
  stopTelegramSnapshotPublisher,
} from './services/snapshot-service.ts'
import { getTelegramCacheConfig } from './store/config-store.ts'
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

    attachTelegramObservation()
    setTelegramObservationEnabled(getTelegramCacheConfig().observationEnabled)

    // 启动恢复：索引指向的对象文件不存在时删除条目，避免把「只剩一条记录」当作可复用内容
    try {
      pruneTelegramRegistry()
    } catch (error) {
      logger.warn('Telegram registry prune failed', { error: (error as Error).message })
    }
    // 启动时按配额收敛一次（超过上限从最久未访问的开始淘汰）；不阻塞初始化
    void enforceTelegramCacheQuota().catch((error: unknown) => {
      logger.warn('Telegram cache quota enforcement failed', { error: (error as Error).message })
    })

    // 本地响应开关默认关闭：只有用户在配置里显式打开才会安装协议处理器
    syncTelegramLocalResponseWithConfig()
    // 页面捕获默认关闭；真正 attach 要等 PAGE_ATTACH 之后
    syncPageCaptureWithConfig()

    registerTelegramCacheHandlers()
    startTelegramSnapshotPublisher()

    // 清缓存会删掉 objects/：索引必须跟着修剪，否则会把「只剩一条记录」当成可复用内容
    registerCacheIntegrityHandler(() => {
      pruneTelegramRegistry()
    })
  },

  async dispose(): Promise<void> {
    stopTelegramSnapshotPublisher()
    disposeBenchmark()
    disposePageCapture()
    disposeMtproto()
    detachTelegramPage()
    disposeTelegramTasks()
    disposeTelegramLocalResponse()
    detachTelegramObservation()
  },
}
