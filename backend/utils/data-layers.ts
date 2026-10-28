// 数据分层的**执行侧**：把 shared/data-layers.ts 的声明翻译成真实路径、用量与清理动作。
//
// 分工（不要混）：
// - shared/data-layers.ts：归属清单（谁在哪一层、能不能备份/清理）+ v1→v2 搬迁表；
// - 本文件：层根解析、按层/按条目统计体积、清缓存；
// - backend/utils/data-layout-upgrade.ts：v1→v2 一次性布局升级。
//
// 硬约束：工具不得再自己 `path.join(getDataDirectory(), '工具', …)`，一律走 resolveLayerPath，
// 否则「可再生 / 不可再生」的边界会在半年后重新糊掉（docs/data-layers.md §5.2）。
import type { DataLayer, DataLayerEntry } from '../../shared/data-layers.ts'
import { existsSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  DATA_LAYER_ENTRIES,
  DATA_LAYERS,
  DATA_LAYOUT_V1_TO_V2,
  joinLayerPath,
} from '../../shared/data-layers.ts'
import { getAssetsRoot as readAssetsRoot } from './assets-root.ts'
import { getDataDirectory } from './data-root.ts'
import { logger } from './logger.ts'

export interface DataLayerUsage {
  bytes: number
  entries: Array<{ id: string, label: string, bytes: number }>
}

export type DataLayerUsages = Record<DataLayer, DataLayerUsage>

export interface CacheLayerCleanResult {
  freedBytes: number
  removedItems: number
  skippedItems: number
}

const MAX_WALK_DEPTH = 24
const WALK_CONCURRENCY = 8

/** 层的物理根目录 */
export function getLayerRoot(layer: DataLayer): string {
  switch (layer) {
    case 'assets':
      return readAssetsRoot()
    case 'config':
    case 'session':
    case 'cache':
      return path.join(getDataDirectory(), layer)
    default: {
      const unreachable: never = layer
      throw new Error(`未知数据层：${String(unreachable)}`)
    }
  }
}

/**
 * 层内路径解析（唯一入口）。
 * `session` 层根就是 Electron 的 sessionData，因此 `resolveLayerPath('session')` 不带片段时
 * 返回的正是 Chromium 会话目录本身。
 */
export function resolveLayerPath(layer: DataLayer, ...segments: string[]): string {
  return path.join(getLayerRoot(layer), ...joinLayerPath(...segments).split('/').filter(Boolean))
}

/**
 * 旧布局（v1 平铺）下的绝对路径，供 v2 过渡期容错回查：
 * 某条目迁移失败时文件还在老位置，读取方先 new 再 legacy，避免「升级把数据读丢」。
 */
export function resolveLegacyPath(relativeToDataRoot: string): string {
  return path.join(getDataDirectory(), ...joinLayerPath(relativeToDataRoot).split('/').filter(Boolean))
}

/**
 * 条目的 v1 旧位置（相对数据根）：直接查搬迁表，查不到说明该条目 v1/v2 同构。
 * 由搬迁表推导而不是让调用方再传一遍——四个调用点传的从来都是同一个字符串。
 */
function legacyRelativeToDataRoot(layer: DataLayer, relativePath: string): string {
  const rule = DATA_LAYOUT_V1_TO_V2.find(item => item.layer === layer && item.to === relativePath)
  return rule?.from ?? relativePath
}

/**
 * 读取用路径：v2 优先，缺失时回查 v1 平铺位置，两处都没有时返回 v2 路径（让写入落到新布局）。
 * **写入一律用 resolveLayerPath**——回查只解决「迁移单条失败」，不应该让数据永久留在旧布局。
 */
export function resolveLayerPathWithFallback(layer: DataLayer, relativePath: string): string {
  const next = resolveLayerPath(layer, relativePath)
  const legacy = resolveLegacyPath(legacyRelativeToDataRoot(layer, relativePath))
  if (next === legacy || existsSync(next)) return next
  return existsSync(legacy) ? legacy : next
}

export function getLayerEntries(layer: DataLayer): readonly DataLayerEntry[] {
  return DATA_LAYER_ENTRIES.filter(entry => entry.layer === layer)
}

async function measureFile(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size
  } catch {
    return 0
  }
}

/** 递归测量目录体积（跳过符号链接，限制深度；不跟随链接避免跑出层外） */
async function measurePath(targetPath: string): Promise<number> {
  try {
    const info = await stat(targetPath)
    if (info.isFile()) return info.size
    if (!info.isDirectory()) return 0
  } catch {
    return 0
  }

  let total = 0
  const stack: Array<{ dir: string, depth: number }> = [{ dir: targetPath, depth: 0 }]
  while (stack.length > 0) {
    const batch = stack.splice(0, WALK_CONCURRENCY)
    const results = await Promise.all(batch.map(async ({ dir, depth }) => {
      let dirents: import('node:fs').Dirent[]
      try {
        dirents = await readdir(dir, { withFileTypes: true })
      } catch {
        return { bytes: 0, next: [] as Array<{ dir: string, depth: number }> }
      }
      const files = dirents.filter(entry => entry.isFile())
      const dirs = dirents.filter(entry => entry.isDirectory())
      const bytes = (await Promise.all(files.map(entry => measureFile(path.join(dir, entry.name)))))
        .reduce((sum, size) => sum + size, 0)
      const next = depth >= MAX_WALK_DEPTH
        ? []
        : dirs.map(entry => ({ dir: path.join(dir, entry.name), depth: depth + 1 }))
      return { bytes, next }
    }))
    for (const result of results) {
      total += result.bytes
      stack.push(...result.next)
    }
  }
  return total
}

/**
 * 按层统计体积（设置页四张卡的数据源）。
 * 条目级明细跳过 relativePath 为 '.' 的条目（那是层根本身，已计入层总量，避免重复计数）。
 */
export async function measureLayers(): Promise<DataLayerUsages> {
  const result = {} as DataLayerUsages
  for (const layer of DATA_LAYERS) {
    const entries = await Promise.all(getLayerEntries(layer)
      .filter(entry => entry.relativePath !== '.')
      .map(async entry => ({
        id: entry.id,
        label: entry.label,
        bytes: await measurePath(resolveLayerPath(layer, entry.relativePath)),
      })))
    result[layer] = {
      bytes: await measurePath(getLayerRoot(layer)),
      entries: entries.filter(entry => entry.bytes > 0).sort((a, b) => b.bytes - a.bytes),
    }
  }
  return result
}

/**
 * 清缓存：只动 cache 层的直接子项（配置层 / 资产层永不进入这里；session 层的
 * Chromium 缓存目录清理走 data-root-scan 的既有口径）。
 * 不跟随符号链接；被占用（Windows 运行中二进制）按 best-effort 跳过。
 */
export async function clearCacheLayer(options: { skipPaths?: string[] } = {}): Promise<CacheLayerCleanResult> {
  const cacheRoot = getLayerRoot('cache')
  const skipPaths = (options.skipPaths ?? []).map(item => path.resolve(item))
  const result: CacheLayerCleanResult = { freedBytes: 0, removedItems: 0, skippedItems: 0 }

  let dirents: import('node:fs').Dirent[]
  try {
    dirents = await readdir(cacheRoot, { withFileTypes: true })
  } catch {
    return result
  }

  for (const dirent of dirents) {
    const target = path.join(cacheRoot, dirent.name)
    const resolved = path.resolve(target)
    if (skipPaths.some(skip => resolved === skip || resolved.startsWith(`${skip}${path.sep}`))) {
      result.skippedItems++
      continue
    }
    const bytes = await measurePath(target)
    try {
      await rm(target, { recursive: true, force: true, maxRetries: 2 })
      result.removedItems++
      result.freedBytes += bytes
    } catch (error) {
      result.skippedItems++
      logger.warn('Failed to clear cache layer item', { item: dirent.name, error: (error as Error).message })
    }
  }

  if (result.removedItems > 0 || result.skippedItems > 0) {
    logger.info('Cache layer cleared', { ...result })
  }
  return result
}
