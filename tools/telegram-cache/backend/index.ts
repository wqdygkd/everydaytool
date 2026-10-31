// telegram-cache 后端入口：
// - initialize：先读数据目录覆盖配置（保证后续路径都落在用户选择的目录），
//   装好 webview 域名导航闸、启动本地站点（都必须在 webview 首次导航前完成）、
//   清理失效索引、注册 IPC、启动快照推送。
// - dispose：停推送 → 解绑页面 → 取消任务，顺序保证退出时不再产生新事件。
// 说明：观测（webRequest / 资源库 / 基准测试）相关界面已在 1.8.0 移除，这里不再挂载 observer，
// 对应服务文件保留以备将来重新接线，但不产生任何运行时开销。
import { registerCacheIntegrityHandler } from '../../../backend/utils/data-root-scan.ts'
import { loadDataDirectoryOverride } from '../../../backend/utils/data-root.ts'
import { logger } from '../../../backend/utils/logger.ts'
import { registerTelegramCacheHandlers } from './ipc/handlers.ts'
import { registerArchiveEngine } from './services/archive-engine.ts'
import { disposeBenchmark } from './services/benchmark-service.ts'
import { enforceTelegramCacheQuota } from './services/cache-manager.ts'
import { disposeTelegramTasks } from './services/download-service.ts'
import { migrateTelegramAccountLayout } from './services/message-store.ts'
import { disposeMtproto } from './services/mtproto-service.ts'
import { detachTelegramPage, installTelegramGuestGuards } from './services/probe-service.ts'
import { disposeTelegramSite, initializeTelegramSite } from './services/site-service.ts'
import {
  startTelegramSnapshotPublisher,
  stopTelegramSnapshotPublisher,
} from './services/snapshot-service.ts'
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

    // v4：托管本地 telegram-tt 构建（同源 /api 与 /media）；dist 缺失时只记录状态，不回退远程站点
    await initializeTelegramSite()

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

    // 旧 messages/acc-<scope>/ 那一级（多账号占位）上移一级：启动即迁移，别让旧消息在状态查询里变成 missing
    void migrateTelegramAccountLayout().then((summary) => {
      if (summary.messages > 0 || summary.media > 0) {
        logger.info('Telegram cache messages layout migrated', {
          messages: summary.messages,
          media: summary.media,
        })
      }
    }).catch((error: unknown) => {
      logger.warn('Telegram cache layout migration failed', { error: (error as Error).message })
    })

    registerTelegramCacheHandlers()
    // 把归档存储暴露给平台层：tweb-cache 工具复用同一份数据，但各有独立站点与 IPC
    registerArchiveEngine()
    startTelegramSnapshotPublisher()

    // 清缓存会删掉 objects/：索引必须跟着修剪，否则会把「只剩一条记录」当成可复用内容
    registerCacheIntegrityHandler(() => {
      pruneTelegramRegistry()
    })
  },

  async dispose(): Promise<void> {
    stopTelegramSnapshotPublisher()
    disposeBenchmark()
    disposeTelegramSite()
    disposeMtproto()
    detachTelegramPage()
    disposeTelegramTasks()
  },
}
