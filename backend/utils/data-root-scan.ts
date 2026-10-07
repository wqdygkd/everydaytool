// 数据根目录的磁盘用量扫描与缓存清理（平台级，与工具域无关）：
// - 用量：总占用 + 顶层条目分解 + Chromium 缓存目录合计
// - 清理：删除目录树下标准 Chromium 缓存目录（Cache / Code Cache / GPUCache 等），
//   只动可再生的缓存，不碰数据库与配置；工具域可通过 registerCacheSkipProvider
//   注册需整体排除的路径（如运行中沙箱的 profile），被占用的文件按 best-effort 跳过。
// 扫描不应用跳过路径（磁盘实况如实呈现）；跳过只作用于清理。
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { getDataDirectory } from './data-root.ts'
import { logger } from './logger.ts'

// Chromium 系浏览器在用户数据目录内固定的缓存目录名（沙箱 profile 内同样适用）
const CHROMIUM_CACHE_DIR_NAMES = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'GraphicsCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GrShaderCache',
  'ShaderCache',
  'Media Cache',
])

const MAX_WALK_DEPTH = 16
/** 同层目录的扫描并发上限：沙箱 profile 常含数万文件，串行遍历会让设置页长时间等待 */
const SCAN_CONCURRENCY = 8
/** 扫描结果短缓存：打开设置 / 清缓存等连续操作不必重复遍历整棵树 */
const SCAN_CACHE_TTL_MS = 10_000
/** 顶层条目最多返回的数量，其余汇总为「其它」，减少 IPC 载荷与 DOM 数量 */
const MAX_TOP_ENTRIES = 30

export interface DataRootEntryUsage {
  name: string
  bytes: number
  isDirectory: boolean
}

export interface DataRootUsage {
  totalBytes: number
  cacheBytes: number
  entries: DataRootEntryUsage[]
}

export interface CacheCleanResult {
  freedBytes: number
  cleanedDirs: number
  skippedDirs: number
}

interface CacheDirInfo {
  path: string
  bytes: number
}

type CacheSkipProvider = () => string[]

// 工具域注册“清理时需整体跳过的路径”提供者（如运行中沙箱的 userData 目录）
const cacheSkipProviders: CacheSkipProvider[] = []

export function registerCacheSkipProvider(provider: CacheSkipProvider): void {
  cacheSkipProviders.push(provider)
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
    const rel = path.relative(skipPath, targetPath)
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return true
  }
  return false
}

interface TreeUsage {
  bytes: number
  cacheBytes: number
  cacheDirs: CacheDirInfo[]
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
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
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

/** 递归测量目录；isCacheRoot 为 true 时整个子树视为单一缓存目录，不再识别内部缓存 */
async function measureTree(dir: string, isCacheRoot: boolean, depth: number): Promise<TreeUsage> {
  if (depth > MAX_WALK_DEPTH) return { bytes: 0, cacheBytes: 0, cacheDirs: [] }

  const dirents = await safeReaddir(dir)
  const usage: TreeUsage = { bytes: 0, cacheBytes: 0, cacheDirs: [] }

  const children = await mapWithConcurrency(dirents, SCAN_CONCURRENCY, async (dirent) => {
    if (dirent.isSymbolicLink()) return { bytes: 0, cacheBytes: 0, cacheDirs: [] }
    const entryPath = path.join(dir, dirent.name)
    if (dirent.isDirectory()) {
      return measureTree(entryPath, !isCacheRoot && CHROMIUM_CACHE_DIR_NAMES.has(dirent.name), depth + 1)
    }
    return { bytes: await measureFile(entryPath), cacheBytes: 0, cacheDirs: [] }
  })

  for (const child of children) {
    usage.bytes += child.bytes
    usage.cacheBytes += child.cacheBytes
    usage.cacheDirs.push(...child.cacheDirs)
  }

  // 空缓存目录也记录（体积 0，删除无害）
  if (isCacheRoot) return { bytes: usage.bytes, cacheBytes: usage.bytes, cacheDirs: [{ path: dir, bytes: usage.bytes }] }
  return usage
}

export interface DataRootScan extends DataRootUsage {
  cacheDirs: CacheDirInfo[]
}

let scanCache: { at: number, result: DataRootScan } | null = null
let scanInFlight: Promise<DataRootScan> | null = null

/** 顶层条目裁剪：只保留体积最大的 N 项，其余汇总为「其它」，避免 IPC 载荷无限增长 */
function summarizeEntries(entries: DataRootEntryUsage[]): DataRootEntryUsage[] {
  if (entries.length <= MAX_TOP_ENTRIES) return entries
  const top = entries.slice(0, MAX_TOP_ENTRIES)
  const rest = entries.slice(MAX_TOP_ENTRIES)
  const restBytes = rest.reduce((sum, item) => sum + item.bytes, 0)
  return [...top, { name: `其它（${rest.length} 项）`, bytes: restBytes, isDirectory: true }]
}

/** 扫描数据根目录：总占用、缓存合计、顶层条目分解（并发遍历 + 短缓存 + in-flight 合并） */
export async function scanDataRoot(options: { force?: boolean } = {}): Promise<DataRootScan> {
  const now = Date.now()
  if (!options.force && scanCache && now - scanCache.at < SCAN_CACHE_TTL_MS) {
    return scanCache.result
  }
  // 同一时刻只跑一次全量扫描，避免多个调用方并发触发重复遍历
  if (scanInFlight) return scanInFlight

  scanInFlight = (async () => {
    const dataDirectory = getDataDirectory()
    const dirents = await safeReaddir(dataDirectory)

    let totalBytes = 0
    const cacheDirs: CacheDirInfo[] = []

    const children = await mapWithConcurrency(dirents, SCAN_CONCURRENCY, async (dirent) => {
      if (dirent.isSymbolicLink()) return null
      const entryPath = path.join(dataDirectory, dirent.name)
      if (dirent.isDirectory()) {
        const child = await measureTree(entryPath, CHROMIUM_CACHE_DIR_NAMES.has(dirent.name), 0)
        return { name: dirent.name, bytes: child.bytes, isDirectory: true, cacheDirs: child.cacheDirs }
      }
      return { name: dirent.name, bytes: await measureFile(entryPath), isDirectory: false, cacheDirs: [] }
    })

    const entries: DataRootEntryUsage[] = []
    for (const child of children) {
      if (!child) continue
      totalBytes += child.bytes
      cacheDirs.push(...child.cacheDirs)
      entries.push({ name: child.name, bytes: child.bytes, isDirectory: child.isDirectory })
    }

    entries.sort((a, b) => b.bytes - a.bytes)
    const result: DataRootScan = {
      totalBytes,
      cacheBytes: cacheDirs.reduce((sum, item) => sum + item.bytes, 0),
      entries: summarizeEntries(entries),
      cacheDirs,
    }
    scanCache = { at: Date.now(), result }
    return result
  })().finally(() => {
    scanInFlight = null
  })

  return scanInFlight
}

/** 数据目录变更后调用：丢弃扫描缓存，避免继续返回旧目录的结果 */
export function invalidateScanCache(): void {
  scanCache = null
}

/** 清理数据根目录下的 Chromium 缓存目录，返回释放的字节数 */
export async function clearDataRootCaches(): Promise<CacheCleanResult> {
  // 清理前即时收集跳过路径：运行状态可能随时变化
  const skipPaths = collectSkipPaths()
  // 复用扫描缓存：连续「清缓存 / 刷新」不再重复全量遍历（清完再失效缓存）
  const { cacheDirs } = await scanDataRoot()

  let freedBytes = 0
  let cleanedDirs = 0
  let skippedDirs = 0

  for (const cacheDir of cacheDirs) {
    if (isWithinSkipped(cacheDir.path, skipPaths)) {
      skippedDirs++
      continue
    }
    try {
      await rm(cacheDir.path, { recursive: true, force: true, maxRetries: 2 })
      cleanedDirs++
      freedBytes += cacheDir.bytes
    } catch (error) {
      // Windows 上被运行中的进程占用的目录会删除失败：跳过，不影响其余缓存
      skippedDirs++
      logger.warn('Failed to remove cache dir', { cacheDir: cacheDir.path, error: (error as Error).message })
    }
  }

  if (cleanedDirs > 0 || skippedDirs > 0) {
    logger.info('Data root caches cleaned', { freedBytes, cleanedDirs, skippedDirs })
  }
  // 缓存目录已被删除，旧扫描结果失效
  invalidateScanCache()
  return { freedBytes, cleanedDirs, skippedDirs }
}
