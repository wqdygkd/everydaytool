import { access, copyFile, cp, link, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { logger } from './logger.ts'

// 损坏 JSON 的备份后缀（保留现场，避免自动覆盖后无法排查）
const CORRUPT_BACKUP_SUFFIX = '.corrupt'

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}

export async function copyPath(
  src: string,
  dest: string,
  options: { filter?: (src: string) => boolean | Promise<boolean> } = {},
): Promise<void> {
  await ensureDir(path.dirname(dest))
  await cp(src, dest, { recursive: true, force: true, filter: options.filter })
}

export async function movePath(src: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest))
  await rename(src, dest)
}

async function linkOrCopyFile(src: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest))
  await removeIfExists(dest)
  try {
    await link(src, dest)
  } catch {
    await copyFile(src, dest)
  }
}

export async function linkOrCopyTree(srcDir: string, destDir: string): Promise<void> {
  if (!await pathExists(srcDir)) return
  await ensureDir(destDir)
  const entries = await readdir(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name)
    const dest = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      await linkOrCopyTree(src, dest)
    } else {
      await linkOrCopyFile(src, dest)
    }
  }
}

export async function copyIfExists(src: string, dest: string): Promise<boolean> {
  if (await pathExists(src)) {
    await copyPath(src, dest)
    return true
  }
  return false
}

export async function removeIfExists(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true, force: true })
}

/**
 * 读取 JSON 并返回 fallback。
 * 与 readJson 的区别：文件不存在属正常，但**解析失败意味着配置已损坏**——
 * 这里必须告警并保留损坏文件副本，不能静默当成默认值（否则用户数据像凭空消失）。
 */
export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  if (!await pathExists(filePath)) return fallback

  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return fallback
  }

  try {
    return JSON.parse(raw) as T
  } catch (error) {
    await backupCorruptedFile(filePath, raw)
    logger.warn('Config file is corrupted, fallback applied', {
      file: path.basename(filePath),
      error: (error as Error).message,
    })
    return fallback
  }
}

async function backupCorruptedFile(filePath: string, raw: string): Promise<void> {
  try {
    await writeFile(`${filePath}${CORRUPT_BACKUP_SUFFIX}`, raw, 'utf8')
  } catch {
    // 备份失败不影响主流程
  }
}

export async function readJson<T = unknown>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath))
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}
