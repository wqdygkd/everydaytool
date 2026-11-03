// Telegram 工具的运行时生命周期：页面挂载才启动本地站点、恢复索引并推送快照；
// 页面卸载立即停站点、停推送并取消工具级任务。配置与归档数据仍是持久层，不受影响。
import { logger } from '../../../../backend/utils/logger.ts'
import { pruneTelegramRegistry } from '../store/resource-registry.ts'
import { enforceTelegramCacheQuota } from './cache-manager.ts'
import { disposeTelegramTasks } from './download-service.ts'
import { migrateTelegramAccountLayout } from './message-store.ts'
import { disposeMtproto } from './mtproto-service.ts'
import { detachTelegramPage } from './probe-service.ts'
import { disposeTelegramSite, initializeTelegramSite } from './site-service.ts'
import {
  startTelegramSnapshotPublisher,
  stopTelegramSnapshotPublisher,
} from './snapshot-service.ts'

let active = false
let lifecycleQueue: Promise<void> = Promise.resolve()

function enqueueLifecycle(task: () => Promise<void>): Promise<void> {
  const run = lifecycleQueue.then(task, task)
  lifecycleQueue = run.catch(() => undefined)
  return run
}

export async function activateTelegramCacheRuntime(): Promise<void> {
  return enqueueLifecycle(async () => {
    if (active) return
    try {
      await initializeTelegramSite()

      // 启动恢复：索引指向的对象文件不存在时删除条目，避免把「只剩一条记录」当作可复用内容
      try {
        pruneTelegramRegistry()
      } catch (error) {
        logger.warn('Telegram registry prune failed', { error: (error as Error).message })
      }

      // 配额与旧目录迁移只做一次后台收敛，不阻塞页面首帧
      void enforceTelegramCacheQuota().catch((error: unknown) => {
        logger.warn('Telegram cache quota enforcement failed', { error: (error as Error).message })
      })
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

      startTelegramSnapshotPublisher()
      active = true
    } catch (error) {
      stopTelegramSnapshotPublisher()
      disposeTelegramSite()
      active = false
      throw error
    }
  })
}

export async function deactivateTelegramCacheRuntime(): Promise<void> {
  return enqueueLifecycle(async () => {
    stopTelegramSnapshotPublisher()
    disposeTelegramSite()
    disposeMtproto()
    detachTelegramPage()
    disposeTelegramTasks()
    active = false
    logger.info('Telegram cache runtime stopped')
  })
}
