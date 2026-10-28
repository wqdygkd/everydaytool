// 数据目录整体迁移（仅用户主动切换目录时使用，不是首次启动迁移）。
//
// 策略：先完整复制到目标目录，全部成功后才删除源目录；任何一步失败都回滚目标中已复制的
// 条目，源目录保持原样，避免出现“一半在旧目录、一半在新目录”的缓存分裂。
//
// `skipCache`：切数据目录时不搬 `cache/`（可再生，往往是整棵树里最大的一块）。
// 跳过就意味着「没搬全」，于是**不删旧目录**，只在日志里点名剩下的东西，由用户自己删。
//
// 调用时机：`loadDataDirectoryOverrideSync()` 在 app ready 之前、sessionData 配置之前。
// 此时 Chromium 尚未打开会话文件，可以安全复制 `session/`。
import { cpSync, existsSync, mkdirSync, readdirSync, rmdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { logger } from './logger.ts'
import { isStrictlyWithin } from './path-guard.ts'

export interface DataDirectoryMigrationOptions {
  /** 跳过顶层 `cache/`（可再生）：跳过时保留旧目录，不删源 */
  skipCache?: boolean
}

export interface DataDirectoryMigrationResult {
  ok: boolean
  moved: string[]
  /** 因 `skipCache` 留在旧目录的条目 */
  skipped: string[]
  error?: string
}

function isEmptyDirectory(directory: string): boolean {
  try {
    return readdirSync(directory).length === 0
  } catch {
    return false
  }
}

/**
 * 把 from 下的全部条目搬到 to。
 * - to 必须为空或不存在；遇到同名条目直接失败（不覆盖用户数据）。
 * - 复制成功后再删源；源目录删空后一并移除。
 */
export function migrateDataDirectory(
  fromPath: string,
  toPath: string,
  options: DataDirectoryMigrationOptions = {},
): DataDirectoryMigrationResult {
  const from = path.resolve(fromPath)
  const to = path.resolve(toPath)
  if (from === to) return { ok: true, moved: [], skipped: [] }
  if (isStrictlyWithin(from, to) || isStrictlyWithin(to, from)) {
    return { ok: false, moved: [], skipped: [], error: '源目录与目标目录不能互相嵌套' }
  }
  if (!existsSync(from)) {
    mkdirSync(to, { recursive: true })
    return { ok: true, moved: [], skipped: [] }
  }
  if (existsSync(to) && !isEmptyDirectory(to)) {
    return { ok: false, moved: [], skipped: [], error: '目标目录非空，请选择空目录' }
  }
  mkdirSync(to, { recursive: true })

  const allEntries = readdirSync(from, { withFileTypes: true })
  // 可再生缓存不搬：它能在新目录里重建，搬它只是把等待时间乘以几十
  const skipCache = options.skipCache === true
  const entries = allEntries.filter(entry => !(skipCache && entry.name === 'cache'))
  const skippedNames = allEntries.filter(entry => skipCache && entry.name === 'cache').map(entry => entry.name)
  const copied: string[] = []
  let currentName: string | null = null
  try {
    for (const entry of entries) {
      const source = path.join(from, entry.name)
      const target = path.join(to, entry.name)
      if (existsSync(target)) {
        throw new Error(`目标目录已存在同名项：${entry.name}`)
      }
      currentName = entry.name
      cpSync(source, target, { recursive: true, force: false, errorOnExist: true })
      copied.push(entry.name)
      currentName = null
    }
  } catch (error) {
    // 回滚本次已复制的条目（含写到一半的当前条目），源目录保持不动
    if (currentName) {
      try {
        rmSync(path.join(to, currentName), { recursive: true, force: true })
      } catch {
        // 清理失败不覆盖原始错误
      }
    }
    for (const name of copied) {
      try {
        rmSync(path.join(to, name), { recursive: true, force: true })
      } catch {
        // 清理失败不覆盖原始错误
      }
    }
    logger.warn('Data directory migration failed', { from, to, error: (error as Error).message })
    return { ok: false, moved: [], skipped: [], error: (error as Error).message }
  }

  for (const entry of entries) {
    try {
      rmSync(path.join(from, entry.name), { recursive: true, force: true })
    } catch (error) {
      logger.warn('Failed to remove migrated source entry', {
        entry: entry.name,
        error: (error as Error).message,
      })
    }
  }
  if (skippedNames.length === 0) {
    try {
      if (isEmptyDirectory(from)) rmdirSync(from)
    } catch {
      // 源目录可能仍被子目录占用；目标数据已完整，忽略
    }
  }

  if (skippedNames.length > 0) {
    logger.warn('Data directory migrated but source kept (skipped regenerable entries)', {
      from,
      skipped: skippedNames,
      hint: '旧目录里只剩可再生缓存，确认新目录可用后可手动删除',
    })
  }
  logger.info('Data directory migrated', { from, to, entries: entries.length, skipped: skippedNames.length })
  return { ok: true, moved: entries.map(entry => entry.name), skipped: skippedNames }
}
