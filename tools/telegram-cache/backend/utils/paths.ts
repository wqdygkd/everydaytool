// telegram-cache 的磁盘布局（按「可不可再生」分层，见 docs/data-layers.md）：
//
//   <data>/config/telegram-cache/     config.json（观测 / 并发 / 上限）
//                                    registry.json（资源索引）
//                                    archive-index.json（归档索引）
//                                    benchmarks.json（测速基准）
//                                    telegram-session.bin（MTProto 会话密文）
//   <assets>/telegram-cache/archive/  归档副本（资产层：源可能已被删，不可再生，可独立设盘）
//   <data>/cache/telegram-cache/      objects/<ab>/<sha256>（按哈希去重的内容对象）
//                                    tmp/<task>.part（下载中临时文件）
//                                    mtproto/partial（MTProto 分段临时文件）
//                                    diagnostics/（脱敏诊断包）
//
// 索引兼容：registry / archive-index 里的 `relativePath` 一律相对「工具命名空间」
// （即 telegram-cache/ 这一级，如 `objects/ab/hash`、`archive/resources/…`），
// 由本文件的 resolveTelegramRelativePath / toTelegramRelativePath 按首段路由到对应层。
// 这样归档从数据目录搬到独立资产根后，**索引内容无需改写**，v1 的旧索引照样能命中。
import type { DataLayer } from '../../../../shared/data-layers.ts'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveLayerPath, resolveLegacyPath } from '../../../../backend/utils/data-layers.ts'

const TOOL_ID = 'telegram-cache'
/** 归缓存层的首段（其余一律按配置层处理） */
const CACHE_HEADS = new Set(['objects', 'tmp', 'mtproto', 'diagnostics'])
/** 归资产层的首段 */
const ASSET_HEADS = new Set(['archive'])

/** 某层的工具命名空间根：`<layer>/telegram-cache` */
export function getTelegramToolRoot(layer: DataLayer): string {
  return resolveLayerPath(layer, TOOL_ID)
}

/** 缓存层：内容对象 / 临时文件 / 诊断包（可再生） */
export function getTelegramCacheRoot(): string {
  return getTelegramToolRoot('cache')
}

/** 配置层：索引与凭据（不可再生） */
export function getTelegramConfigRoot(): string {
  return getTelegramToolRoot('config')
}

/** 资产层：归档副本（不可再生，落独立资产根） */
export function getTelegramArchiveRoot(): string {
  return resolveLayerPath('assets', TOOL_ID, 'archive')
}

export function getTelegramConfigPath(): string {
  return path.join(getTelegramConfigRoot(), 'config.json')
}

export function getTelegramRegistryPath(): string {
  return path.join(getTelegramConfigRoot(), 'registry.json')
}

export function getTelegramArchiveIndexPath(): string {
  return path.join(getTelegramConfigRoot(), 'archive-index.json')
}

export function getTelegramBenchmarkPath(): string {
  return path.join(getTelegramConfigRoot(), 'benchmarks.json')
}

export function getTelegramObjectsDir(): string {
  return path.join(getTelegramCacheRoot(), 'objects')
}

export function getTelegramTmpDir(): string {
  return path.join(getTelegramCacheRoot(), 'tmp')
}

export function getTelegramDiagnosticsDir(): string {
  return path.join(getTelegramCacheRoot(), 'diagnostics')
}

/** 记录里的相对路径 → 所属层的工具命名空间根（解析与越界校验共用同一来源） */
export function resolveTelegramRelativeRoot(relativePath: string): string {
  const head = relativePath.split('/')[0] ?? ''
  if (ASSET_HEADS.has(head)) return getTelegramToolRoot('assets')
  if (CACHE_HEADS.has(head)) return getTelegramToolRoot('cache')
  return getTelegramToolRoot('config')
}

/**
 * 记录里的相对路径 → 绝对路径。
 * v2 位置优先；某条目因布局升级失败仍留在 v1 平铺位置时回查旧根（否则会把「已下载」误判成「没下载」）。
 */
export function resolveTelegramRelativePath(relativePath: string): string {
  const primary = path.join(resolveTelegramRelativeRoot(relativePath), ...relativePath.split('/').filter(Boolean))
  if (existsSync(primary)) return primary
  const legacy = path.join(resolveLegacyPath(TOOL_ID), ...relativePath.split('/').filter(Boolean))
  return existsSync(legacy) ? legacy : primary
}

/** 绝对路径 → 记录用的相对路径（相对工具命名空间，与 v1 索引格式一致） */
export function toTelegramRelativePath(absolutePath: string): string {
  const layers: DataLayer[] = ['config', 'assets', 'cache']
  for (const layer of layers) {
    const root = getTelegramToolRoot(layer)
    const relative = path.relative(root, absolutePath)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/')
    }
  }
  // 兜底：v1 平铺布局（升级失败时仍可能往旧位置写）
  return path.relative(resolveLegacyPath(TOOL_ID), absolutePath).split(path.sep).join('/')
}
