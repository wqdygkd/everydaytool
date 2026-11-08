// tweb-cache 归档根目录的单独自定义（不改变全局资产根）。
//
// 默认位置仍是 `<assets>/tweb-cache`；用户选择新目录后，把该工具自己的 messages/ 与 trash/
// 整体迁过去，索引（config/media-index.json、messages-index/）里的相对路径保持不变。
// 迁移失败会回滚已移动的条目，配置只在全部成功后才落盘。
import type { TwebCacheArchiveDirChangeResult, TwebCacheArchiveDirInfo } from '../../../../shared/tweb-cache.ts'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { checkAssetsRootRelation, getAssetsRoot } from '../../../../backend/utils/assets-root.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { isSafeAssetsDirectory, isSamePath, isStrictlyWithin } from '../../../../backend/utils/path-guard.ts'
import { updateTwebCacheConfig } from '../store/config-store.ts'
import { getArchiveDir, getDefaultArchiveDir } from './paths.ts'

/** 归档根下由本工具独占、切换目录时需要一起搬走的条目 */
const MOVED_ENTRIES = ['messages', 'trash'] as const

export function getArchiveDirInfo(): TwebCacheArchiveDirInfo {
  const archiveDir = getArchiveDir()
  return {
    archiveDir,
    defaultArchiveDir: getDefaultArchiveDir(),
    isCustom: !isSamePath(archiveDir, getDefaultArchiveDir()),
  }
}

async function entryNames(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).sort()
  } catch {
    return []
  }
}

/**
 * 目标目录必须为空；允许预建空的 messages/、trash/（方便用户按提示准备目录）。
 * 返回需要先移除的空壳目录。
 */
async function assertTargetIsEmpty(target: string): Promise<string[]> {
  if (!existsSync(target)) return []

  const info = await stat(target).catch(() => null)
  if (!info) return []
  if (!info.isDirectory()) throw new Error('目标路径不是目录')

  const entries = await readdir(target, { withFileTypes: true })
  const emptyShells: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory() && (MOVED_ENTRIES as readonly string[]).includes(entry.name)) {
      const child = path.join(target, entry.name)
      if ((await entryNames(child)).length === 0) {
        emptyShells.push(child)
        continue
      }
    }
    throw new Error('目标目录非空，请选择一个空目录（迁移不会覆盖已有文件）')
  }
  return emptyShells
}

function isCrossDevice(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EXDEV' || code === 'EPERM'
}

/** 同盘直接 rename；跨盘（EXDEV）退化为复制全部成功后再删源。 */
async function moveDirectory(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
    return
  } catch (error) {
    if (!isCrossDevice(error)) throw error
  }

  try {
    await cp(from, to, { recursive: true, force: false, errorOnExist: true })
  } catch (error) {
    // 复制中途失败会留下半成品；先清掉目标，避免污染用户选的目录、也避免下次重试被判「非空」
    await rm(to, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  try {
    await rm(from, { recursive: true, force: true })
  } catch (error) {
    // 源没删掉时不留下第二份半成品：撤掉目标，保持旧位置可用
    await rm(to, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

async function rollbackMoved(
  fromRoot: string,
  toRoot: string,
  moved: string[],
): Promise<string[]> {
  const failed: string[] = []
  for (const name of [...moved].reverse()) {
    try {
      await moveDirectory(path.join(toRoot, name), path.join(fromRoot, name))
    } catch (error) {
      failed.push(name)
      logger.warn('Failed to roll back archive directory move', {
        name,
        error: (error as Error).message,
      })
    }
  }
  return failed
}

function assertSameVolumeRelation(from: string, to: string): void {
  if (isSamePath(from, to)) return
  if (isStrictlyWithin(from, to) || isStrictlyWithin(to, from)) {
    throw new Error('归档目录不能与当前目录互相嵌套')
  }
}

/**
 * 切换归档根目录。传 null / 空字符串表示恢复默认 `<assets>/tweb-cache`。
 * 目标必须为空；现有 messages/、trash/ 会迁移过去，失败时回滚。
 */
export async function changeArchiveDirectory(nextDirectory: string | null): Promise<TwebCacheArchiveDirChangeResult> {
  const currentDir = getArchiveDir()
  const defaultDir = getDefaultArchiveDir()
  const target = nextDirectory?.trim() ? path.resolve(nextDirectory.trim()) : defaultDir

  if (isSamePath(target, currentDir)) {
    return { ...getArchiveDirInfo(), changed: false, moved: [] }
  }

  const guard = isSafeAssetsDirectory(target)
  if (!guard.ok) throw new Error(guard.reason || '归档目录不合法')
  const relationError = checkAssetsRootRelation(target)
  if (relationError) throw new Error(relationError)
  if (isSamePath(target, getAssetsRoot())) {
    throw new Error('请选择独立子目录，不能直接使用资产根目录')
  }
  assertSameVolumeRelation(currentDir, target)

  const emptyShells = await assertTargetIsEmpty(target)
  for (const shell of emptyShells) {
    await rm(shell, { recursive: true, force: true })
  }

  const targetExisted = existsSync(target)
  const moved: string[] = []
  try {
    await mkdir(target, { recursive: true })

    for (const name of MOVED_ENTRIES) {
      const source = path.join(currentDir, name)
      if (!existsSync(source)) continue
      await moveDirectory(source, path.join(target, name))
      moved.push(name)
    }

    updateTwebCacheConfig({ archiveDir: isSamePath(target, defaultDir) ? null : target })
  } catch (error) {
    const failedRollback = await rollbackMoved(currentDir, target, moved)
    if (!targetExisted && failedRollback.length === 0) {
      await rm(target, { recursive: true, force: true }).catch(() => undefined)
    }
    const rollbackNote = failedRollback.length
      ? `；以下条目未能回滚：${failedRollback.join(', ')}`
      : ''
    throw new Error(`切换归档目录失败：${(error as Error).message}${rollbackNote}`)
  }

  logger.info('Archive directory changed', {
    from: currentDir,
    to: target,
    moved,
  })

  return { ...getArchiveDirInfo(), changed: true, moved }
}
