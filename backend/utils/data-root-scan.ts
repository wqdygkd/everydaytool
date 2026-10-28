import type { DataLayerUsageInfo, DataUsage } from '../../shared/app.ts'
// 数据根目录的**按层**用量统计与缓存清理（平台级，与工具域无关）。
//
// 分层模型见 docs/data-layers.md 与 shared/data-layers.ts：
// - 用量：四层（配置 / 资产 / 会话 / 缓存）各自体积 + 条目明细；资产根独立于数据根扫描；
// - 清理：**只动可再生部分** —— 整个 cache 层 + session 层内部的 Chromium 缓存目录；
//   配置层与资产层永不进入清理路径（账号、规则、证书、归档都在那里）。
//
// 工具域可通过 registerCacheSkipProvider 注册需跳过的路径（如运行中沙箱的 profile），
// 被占用的文件按 best-effort 跳过。扫描不应用跳过路径（磁盘实况如实呈现）；跳过只作用于清理。
import type { DataLayer } from '../../shared/data-layers.ts'
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { CHROMIUM_SESSION_CACHE_DIRS, DATA_LAYER_META, DATA_LAYERS } from '../../shared/data-layers.ts'
import { getAssetsRoot } from './assets-root.ts'
import { clearCacheLayer, getLayerRoot, measureLayers } from './data-layers.ts'
import { getDataDirectory } from './data-root.ts'
import { logger } from './logger.ts'
import { comparePaths } from './path-guard.ts'

// Chromium 系浏览器在用户数据目录内固定的缓存目录名：清单的唯一来源在 shared/data-layers.ts
const CHROMIUM_CACHE_DIR_NAMES = new Set<string>(CHROMIUM_SESSION_CACHE_DIRS)

const MAX_WALK_DEPTH = 12
const SCAN_CONCURRENCY = 8
/** 扫描结果短缓存：打开设置 / 清缓存等连续操作不必重复遍历整棵树 */
const SCAN_CACHE_TTL_MS = 10_000

export interface CacheCleanResult {
  freedBytes: number
  cleanedDirs: number
  /** 因路径被跳过（如运行中沙箱）或被占用而未清理的目录数 */
  skippedDirs: number
}

interface CacheDirInfo {
  path: string
  bytes: number
}

export interface DataRootScan extends DataUsage {
  /** 清理时需要逐个删除的目录（cache 层根 + 会话层内的 Chromium 缓存目录） */
  cacheDirs: CacheDirInfo[]
}

type CacheSkipProvider = () => string[]

// 工具域注册“清理时需整体跳过的路径”提供者（如运行中沙箱的 userData 目录）
const cacheSkipProviders: CacheSkipProvider[] = []

export function registerCacheSkipProvider(provider: CacheSkipProvider): void {
  cacheSkipProviders.push(provider)
}

/**
 * 清理后的**自愈钩子**：工具的「已安装 / 索引有效」这类状态与缓存层文件绑在一起，
 * 清掉缓存后必须重算，否则 UI 会继续显示「已安装 / 命中」而实际文件已经没了。
 * 对应 shared/data-layers.ts 条目上的 `integrity` 字段。
 */
type CacheIntegrityHandler = () => void | Promise<void>

const cacheIntegrityHandlers: CacheIntegrityHandler[] = []

export function registerCacheIntegrityHandler(handler: CacheIntegrityHandler): void {
  cacheIntegrityHandlers.push(handler)
}

async function runCacheIntegrityHandlers(): Promise<void> {
  for (const handler of cacheIntegrityHandlers) {
    try {
      await handler()
    } catch (error) {
      logger.warn('Cache integrity handler failed', { error: (error as Error).message })
    }
  }
}

function collectSkipPaths(): Set<string> {
  const skipPaths = new Set<string>()
  for (const provider of cacheSkipProviders) {
    try {
      for (const skipPath of provider()) skipPaths.add(path.resolve(skipPath))
    } catch (error) {
      logger.warn('Cache skip provider failed', { error: (error as Error).message })
    }
  }
  return skipPaths
}

function isWithinSkipped(targetPath: string, skipPaths: Set<string>): boolean {
  for (const skipPath of skipPaths) {
    const relation = comparePaths(skipPath, targetPath)
    if (relation.same || relation.inside) return true
  }
  return false
}

async function safeReaddir(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function measureFile(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size
  } catch {
    return 0
  }
}

/** 有界并发执行映射：保持结果顺序，避免对大目录做无限制并发导致 EMFILE */
async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(items[index])
    }
  }
  const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => worker())
  await Promise.all(workers)
  return results
}

/** 递归测量目录体积（跳过符号链接） */
async function measureTree(dir: string, depth: number): Promise<number> {
  if (depth > MAX_WALK_DEPTH) return 0
  const dirents = await safeReaddir(dir)
  const sizes = await mapWithConcurrency(dirents, SCAN_CONCURRENCY, async (dirent) => {
    if (dirent.isSymbolicLink()) return 0
    const entryPath = path.join(dir, dirent.name)
    if (dirent.isDirectory()) return measureTree(entryPath, depth + 1)
    return measureFile(entryPath)
  })
  return sizes.reduce((sum, size) => sum + size, 0)
}

/**
 * 找出会话层内部的 Chromium 缓存目录（命中目录名即整棵计入，不再往里找）。
 * 这些目录是会话层里唯一允许被清的部分：Cookies / LocalStorage / Partitions 里的 IndexedDB 都不受影响。
 */
async function collectSessionCacheDirs(dir: string, depth: number, found: CacheDirInfo[]): Promise<void> {
  if (depth > MAX_WALK_DEPTH) return
  const dirents = await safeReaddir(dir)
  await mapWithConcurrency(dirents, SCAN_CONCURRENCY, async (dirent) => {
    if (dirent.isSymbolicLink() || !dirent.isDirectory()) return
    const entryPath = path.join(dir, dirent.name)
    if (CHROMIUM_CACHE_DIR_NAMES.has(dirent.name)) {
      found.push({ path: entryPath, bytes: await measureTree(entryPath, 0) })
      return
    }
    await collectSessionCacheDirs(entryPath, depth + 1, found)
  })
}

let scanCache: { at: number, result: DataRootScan } | null = null
let scanInFlight: Promise<DataRootScan> | null = null

/**
 * 扫描四层用量：总占用、可清理合计、层明细、条目明细。
 * 并发遍历 + 短缓存 + in-flight 合并，避免设置页连续刷新时重复全量遍历。
 */
export async function scanDataLayers(options: { force?: boolean } = {}): Promise<DataRootScan> {
  const now = Date.now()
  if (!options.force && scanCache && now - scanCache.at < SCAN_CACHE_TTL_MS) {
    return scanCache.result
  }
  if (scanInFlight) return scanInFlight

  scanInFlight = (async () => {
    const usages = await measureLayers()

    // 会话层里的 Chromium 缓存：可清理部分（登录态不动）
    const sessionCacheDirs: CacheDirInfo[] = []
    await collectSessionCacheDirs(getLayerRoot('session'), 0, sessionCacheDirs)
    const sessionCacheBytes = sessionCacheDirs.reduce((sum, item) => sum + item.bytes, 0)

    // 整个 cache 层都可清（隔离区在配置层，不在这个范围里）
    const cacheLayerDirs: CacheDirInfo[] = [{ path: getLayerRoot('cache'), bytes: usages.cache.bytes }]

    const layers: DataLayerUsageInfo[] = DATA_LAYERS.map((layer: DataLayer) => {
      const meta = DATA_LAYER_META[layer]
      const usage = usages[layer]
      const cleanableBytes = layer === 'cache'
        ? usage.bytes
        : layer === 'session'
          ? sessionCacheBytes
          : 0
      return {
        layer,
        label: meta.label,
        summary: meta.summary,
        bytes: usage.bytes,
        cleanableBytes,
        cleanable: meta.cleanable,
        entries: usage.entries,
      }
    })

    const result: DataRootScan = {
      dataDirectory: getDataDirectory(),
      assetsRoot: getAssetsRoot(),
      totalBytes: layers.reduce((sum, item) => sum + item.bytes, 0),
      cleanableBytes: layers.reduce((sum, item) => sum + item.cleanableBytes, 0),
      layers,
      cacheDirs: [...cacheLayerDirs, ...sessionCacheDirs],
    }
    scanCache = { at: Date.now(), result }
    return result
  })().finally(() => {
    scanInFlight = null
  })

  return scanInFlight
}

/** 清空扫描缓存（清理缓存目录后调用；下一次扫描会按磁盘现状重建） */
export function invalidateScanCache(): void {
  scanCache = null
}

/**
 * 清理可再生数据：整个 cache 层 + 会话层内的 Chromium 缓存目录。
 * **配置层与资产层不在这里出现**——它们的 clean 策略是 `never`（shared/data-layers.ts）。
 */
export async function clearDataLayerCaches(): Promise<CacheCleanResult> {
  const skipPaths = collectSkipPaths()
  const result: CacheCleanResult = { freedBytes: 0, cleanedDirs: 0, skippedDirs: 0 }

  // 1) 会话层内部的 Chromium 缓存目录（登录态所在的其它子目录不动）
  const sessionCacheDirs: CacheDirInfo[] = []
  await collectSessionCacheDirs(getLayerRoot('session'), 0, sessionCacheDirs)
  for (const cacheDir of sessionCacheDirs) {
    if (isWithinSkipped(cacheDir.path, skipPaths)) {
      result.skippedDirs++
      continue
    }
    try {
      await rm(cacheDir.path, { recursive: true, force: true, maxRetries: 2 })
      result.cleanedDirs++
      result.freedBytes += cacheDir.bytes
    } catch (error) {
      // Windows 上被运行中的进程占用的目录会删除失败：跳过，不影响其余缓存
      result.skippedDirs++
      logger.warn('Failed to remove session cache dir', { cacheDir: cacheDir.path, error: (error as Error).message })
    }
  }

  // 2) cache 层整体（工具自己的可再生数据：objects / downloads / runtime / 隔离区 …）
  const cacheLayer = await clearCacheLayer({ skipPaths: [...skipPaths] })
  result.freedBytes += cacheLayer.freedBytes
  result.cleanedDirs += cacheLayer.removedItems
  result.skippedDirs += cacheLayer.skippedItems

  // 3) 自愈：重算与缓存文件绑定的工具状态（索引修剪 / 已安装 / 历史文件缺失）
  if (result.cleanedDirs > 0) await runCacheIntegrityHandlers()

  if (result.cleanedDirs > 0 || result.skippedDirs > 0) {
    logger.info('Data layer caches cleared', { ...result })
  }
  invalidateScanCache()
  return result
}
