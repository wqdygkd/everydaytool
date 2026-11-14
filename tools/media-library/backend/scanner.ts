// 只读目录遍历：导入前的整棵目录树扫描与重新扫描共用。
//
// 这里只做 readdir + stat，不打开文件、不写任何东西。隐藏文件、系统缩略图数据库、
// 临时文件一律跳过；不认识的扩展名计入「其他文件」但不进入索引。
import type { MediaKind, ScanNode, ScanOptions } from '../../../shared/media-library.ts'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { isHiddenName, isIgnoredFileName, isPathInside, mediaKindOf } from '../../../shared/media-library.ts'

export interface ScannedFile {
  /** 相对扫描根，`/` 分隔 */
  relPath: string
  name: string
  kind: MediaKind
  size: number
  mtimeMs: number
}

export interface WalkResult {
  tree: ScanNode
  /** 目录相对路径 → 该目录直接包含的媒体文件 */
  filesByDir: Map<string, ScannedFile[]>
  folders: number
  files: number
}

export interface WalkOptions {
  scan: ScanOptions
  /** 相对扫描根的排除目录：整棵子树不进入 */
  excluded?: readonly string[]
  isCancelled?: () => boolean
  onProgress?: (state: { files: number, folders: number, current: string }) => void
}

export class ScanCancelledError extends Error {
  constructor() {
    super('扫描已取消')
    this.name = 'ScanCancelledError'
  }
}

const MAX_DEPTH = 32
const STAT_CONCURRENCY = 16
/** Windows 卷根下的系统目录：即使勾了「包含隐藏文件」也没有可索引内容，还可能无权限 */
const SYSTEM_DIR_NAMES = new Set(['$recycle.bin', 'system volume information', '$windows.~bt', '$windows.~ws'])

export async function mapLimit<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  let cursor = 0
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

export async function walkMediaTree(rootPath: string, options: WalkOptions): Promise<WalkResult> {
  const excluded = options.excluded ?? []
  const filesByDir = new Map<string, ScannedFile[]>()
  let folders = 0
  let files = 0

  async function visit(absDir: string, relDir: string, name: string, depth: number): Promise<ScanNode> {
    if (options.isCancelled?.()) throw new ScanCancelledError()
    const node: ScanNode = { path: relDir, name, videos: 0, images: 0, other: 0, bytes: 0, children: [] }
    folders++

    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch {
      // 无权限 / 中途被移走的目录：当作空目录，不中断整次扫描
      return node
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }))

    const mediaEntries: Array<{ name: string, kind: MediaKind }> = []
    const childDirs: string[] = []
    for (const entry of entries) {
      if (!options.scan.hidden && isHiddenName(entry.name)) continue
      if (entry.isDirectory()) {
        if (SYSTEM_DIR_NAMES.has(entry.name.toLowerCase())) continue
        childDirs.push(entry.name)
        continue
      }
      // 符号链接不跟随：既避免环，也避免把库外的文件算进来
      if (!entry.isFile()) continue
      if (isIgnoredFileName(entry.name)) continue
      const kind = mediaKindOf(entry.name)
      if (!kind || (kind === 'video' && !options.scan.video) || (kind === 'image' && !options.scan.image)) {
        node.other++
        continue
      }
      mediaEntries.push({ name: entry.name, kind })
    }

    const scanned = await mapLimit(mediaEntries, STAT_CONCURRENCY, async (entry): Promise<ScannedFile | null> => {
      try {
        const info = await stat(path.join(absDir, entry.name))
        return {
          relPath: relDir ? `${relDir}/${entry.name}` : entry.name,
          name: entry.name,
          kind: entry.kind,
          size: info.size,
          mtimeMs: Math.round(info.mtimeMs),
        }
      } catch {
        return null
      }
    })
    const list = scanned.filter((file): file is ScannedFile => file !== null)
    for (const file of list) {
      if (file.kind === 'video') node.videos++
      else node.images++
      node.bytes += file.size
    }
    if (list.length) filesByDir.set(relDir, list)
    files += list.length
    options.onProgress?.({ files, folders, current: relDir || name })

    if (options.scan.recursive && depth < MAX_DEPTH) {
      for (const childName of childDirs) {
        const childRel = relDir ? `${relDir}/${childName}` : childName
        if (excluded.some(ex => ex === childRel || isPathInside(ex, childRel))) continue
        node.children.push(await visit(path.join(absDir, childName), childRel, childName, depth + 1))
      }
    }
    return node
  }

  const tree = await visit(rootPath, '', path.basename(rootPath) || rootPath, 0)
  return { tree, filesByDir, folders, files }
}

/** 一棵子树（扣除排除目录）内的全部媒体文件，按路径自然序排列 */
export function collectFiles(filesByDir: Map<string, ScannedFile[]>, root: string, excluded: readonly string[]): ScannedFile[] {
  const out: ScannedFile[] = []
  for (const [dir, list] of filesByDir) {
    if (dir !== root && !isPathInside(root, dir)) continue
    if (excluded.some(ex => ex === dir || isPathInside(ex, dir))) continue
    out.push(...list)
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh', { numeric: true }))
}
