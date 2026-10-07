// 数据根目录的磁盘用量扫描与缓存清理（平台级，与工具域无关）：
// - 用量：总占用 + 顶层条目分解 + Chromium 缓存目录合计
// - 清理：删除目录树下标准 Chromium 缓存目录（Cache / Code Cache / GPUCache 等），
//   只动可再生的缓存，不碰数据库与配置；工具域可通过 registerCacheSkipProvider
//   注册需整体排除的路径（如运行中沙箱的 profile），被占用的文件按 best-effort 跳过。
// 扫描不应用跳过路径（磁盘实况如实呈现）；跳过只作用于清理。
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { getDataDirectory } from './data-root.js'
import { logger } from './logger.js'

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

/** 递归测量目录；isCacheRoot 为 true 时整个子树视为单一缓存目录，不再识别内部缓存 */
async function measureTree(dir: string, isCacheRoot: boolean, depth: number): Promise<TreeUsage> {
  if (depth > MAX_WALK_DEPTH) return { bytes: 0, cacheBytes: 0, cacheDirs: [] }

  const dirents = await safeReaddir(dir)
  const usage: TreeUsage = { bytes: 0, cacheBytes: 0, cacheDirs: [] }
  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) continue
    const entryPath = path.join(dir, dirent.name)
    if (dirent.isDirectory()) {
      const child = await measureTree(entryPath, !isCacheRoot && CHROMIUM_CACHE_DIR_NAMES.has(dirent.name), depth + 1)
      usage.bytes += child.bytes
      usage.cacheBytes += child.cacheBytes
      usage.cacheDirs.push(...child.cacheDirs)
    } else {
      usage.bytes += await measureFile(entryPath)
    }
  }

  // 空缓存目录也记录（体积 0，删除无害）
  if (isCacheRoot) return { bytes: usage.bytes, cacheBytes: usage.bytes, cacheDirs: [{ path: dir, bytes: usage.bytes }] }
  return usage
}

export interface DataRootScan extends DataRootUsage {
  cacheDirs: CacheDirInfo[]
}

/** 扫描数据根目录：总占用、缓存合计、顶层条目分解（磁盘实况，异步全量遍历） */
export async function scanDataRoot(): Promise<DataRootScan> {
  const dataDirectory = getDataDirectory()
  const dirents = await safeReaddir(dataDirectory)

  const entries: DataRootEntryUsage[] = []
  let totalBytes = 0
  let cacheBytes = 0
  const cacheDirs: CacheDirInfo[] = []

  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) continue
    const entryPath = path.join(dataDirectory, dirent.name)
    if (dirent.isDirectory()) {
      const child = await measureTree(entryPath, CHROMIUM_CACHE_DIR_NAMES.has(dirent.name), 0)
      totalBytes += child.bytes
      cacheBytes += child.cacheBytes
      cacheDirs.push(...child.cacheDirs)
      entries.push({ name: dirent.name, bytes: child.bytes, isDirectory: true })
    } else {
      const bytes = await measureFile(entryPath)
      totalBytes += bytes
      entries.push({ name: dirent.name, bytes, isDirectory: false })
    }
  }

  entries.sort((a, b) => b.bytes - a.bytes)
  return { totalBytes, cacheBytes, entries, cacheDirs }
}

/** 清理数据根目录下的 Chromium 缓存目录，返回释放的字节数 */
export async function clearDataRootCaches(): Promise<CacheCleanResult> {
  // 清理前即时收集跳过路径：运行状态可能随时变化
  const skipPaths = collectSkipPaths()
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
  return { freedBytes, cleanedDirs, skippedDirs }
}
