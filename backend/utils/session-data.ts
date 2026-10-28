import { mkdirSync } from 'node:fs'
// Chromium 会话数据目录（cookies / cache / LocalStorage / Partitions）统一放在应用数据目录下。
//
// Electron 没有“每个 persist 分区自定义路径”的 API；唯一受支持的物理落盘方式是：
// 在 app ready 之前调用 app.setPath('sessionData', <data-root>/session)。
// 这样所有分区（Persist:telegram-cache、persist:treease-editor）都直接写在
// <data-root>/session/Partitions/<name>，**不使用任何 junction / 软链**。
//
// 约束：
// - 必须在 ready 之前调用；运行期切换数据目录只在下次启动生效；
// - 会同时移动应用自身的 localStorage（收藏 / 页签），不做迁移（开发阶段取舍）。
import path from 'node:path'
import process from 'node:process'
import { app } from 'electron'
import { getLayerRoot, resolveLayerPath } from './data-layers.ts'
import { logger } from './logger.ts'

/** 在 app ready 之前调用一次；返回实际使用的 sessionData 目录 */
export function configureSessionDataDirectory(): string {
  // session 层根就是 Electron 的 sessionData（唯一事实来源：shared/data-layers.ts）
  const target = path.resolve(getLayerRoot('session'))
  try {
    mkdirSync(target, { recursive: true })
    app.setPath('sessionData', target)
  } catch (error) {
    // 数据目录不可写 / 路径非法：保留 Electron 默认 sessionData，避免启动直接崩溃
    logger.warn('Failed to configure sessionData directory; using default', {
      target,
      error: (error as Error).message,
    })
  }
  // Electron 自己的崩溃转储 / 日志也不要留在 userData（属可再生缓存层，见 docs/data-layers.md）
  try {
    mkdirSync(resolveLayerPath('cache', 'app', 'crash-dumps'), { recursive: true })
    mkdirSync(resolveLayerPath('cache', 'app', 'logs'), { recursive: true })
    app.setPath('crashDumps', resolveLayerPath('cache', 'app', 'crash-dumps'))
    app.setPath('logs', resolveLayerPath('cache', 'app', 'logs'))
  } catch (error) {
    logger.warn('Failed to configure Electron crash/log directories', { error: (error as Error).message })
  }
  return app.getPath('sessionData')
}

export function getSessionDataDirectory(): string {
  return app.getPath('sessionData')
}

export function getPartitionStoragePath(partition: string): string {
  return path.join(getSessionDataDirectory(), 'Partitions', partition)
}

/** sessionData 是否已指向当前数据目录；false 表示需要重启才能切换 */
export function isSessionDataInDataDirectory(): boolean {
  const current = path.resolve(getSessionDataDirectory())
  const expected = path.resolve(getLayerRoot('session'))
  if (process.platform === 'win32') {
    return current.toLowerCase() === expected.toLowerCase()
  }
  return current === expected
}
