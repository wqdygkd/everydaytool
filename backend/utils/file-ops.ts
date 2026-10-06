import { access, copyFile, cp, link, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

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

export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    if (await pathExists(filePath)) {
      return JSON.parse(await readFile(filePath, 'utf8')) as T
    }
  } catch {
    // ignore parse errors
  }
  return fallback
}

export async function readJson<T = unknown>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath))
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}
