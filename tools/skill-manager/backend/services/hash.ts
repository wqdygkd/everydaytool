import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const SKIP_DIRS = new Set(['.git', 'node_modules'])
const SKIP_FILES = new Set(['.DS_Store'])

/**
 * 与 `npx skills` 的项目锁算法一致：递归普通文件，跳过 .git / node_modules，
 * 路径统一为 `/` 后按 localeCompare 排序，把「相对路径 + 文件内容」依次喂给 sha256。
 * 符号链接不参与，避免把链接目标的内容算进技能指纹。
 */
export async function hashSkillDirectory(root: string): Promise<string> {
  const files: string[] = []
  await collectFiles(root, root, files)
  files.sort((a, b) => a.localeCompare(b))

  const hash = createHash('sha256')
  for (const relativePath of files) {
    hash.update(relativePath)
    hash.update(await readFile(join(root, ...relativePath.split('/'))))
  }
  return hash.digest('hex')
}

async function collectFiles(root: string, dir: string, output: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.skill-manager-')) continue
    const abs = join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await collectFiles(root, abs, output)
      continue
    }
    if (!entry.isFile() || SKIP_FILES.has(entry.name)) continue
    output.push(relative(root, abs).split(sep).join('/'))
  }
}

/** 目录是否存在且不是符号链接；用于安装前检查目标。 */
export async function isRealDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory()
  } catch {
    return false
  }
}
