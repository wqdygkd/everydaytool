// telegram-cache 的磁盘布局（全部落在数据根目录下，随设置里的数据目录切换）：
//   telegram-cache/
//     config.json            观测 / 并发 / 单资源上限
//     registry.json          资源索引（校验过的内容文件引用）
//     archive-index.json     归档索引（每条归档的清单指针）
//     objects/<ab>/<sha256>  校验过的内容对象（按哈希去重，文件名即哈希）
//     tmp/<task>.part        下载中的临时文件（启动时清理，绝不当作完整文件）
//     archive/resources/…    归档副本（与资源库解耦，缓存淘汰不影响归档）
//     diagnostics/…          脱敏诊断包
import path from 'node:path'
import { getDataDirectory } from '../../../../backend/utils/data-root.ts'

export function getTelegramCacheRoot(): string {
  return path.join(getDataDirectory(), 'telegram-cache')
}

export function getTelegramConfigPath(): string {
  return path.join(getTelegramCacheRoot(), 'config.json')
}

export function getTelegramRegistryPath(): string {
  return path.join(getTelegramCacheRoot(), 'registry.json')
}

export function getTelegramArchiveIndexPath(): string {
  return path.join(getTelegramCacheRoot(), 'archive-index.json')
}

export function getTelegramBenchmarkPath(): string {
  return path.join(getTelegramCacheRoot(), 'benchmarks.json')
}

export function getTelegramObjectsDir(): string {
  return path.join(getTelegramCacheRoot(), 'objects')
}

export function getTelegramTmpDir(): string {
  return path.join(getTelegramCacheRoot(), 'tmp')
}

export function getTelegramArchiveRoot(): string {
  return path.join(getTelegramCacheRoot(), 'archive')
}

export function getTelegramDiagnosticsDir(): string {
  return path.join(getTelegramCacheRoot(), 'diagnostics')
}

/** 对象文件相对数据根目录的路径（写进索引，便于诊断包与 UI 展示） */
export function toTelegramRelativePath(absolutePath: string): string {
  const root = getTelegramCacheRoot()
  return path.relative(root, absolutePath).split(path.sep).join('/')
}
