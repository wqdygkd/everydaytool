import type { SkillOrigin } from '../../../../shared/skill-manager.ts'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'

const SKIP_NAMES = new Set(['.git', 'node_modules'])

export class InstallTransactionError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'InstallTransactionError'
    this.code = code
  }
}

export interface TrashEntry {
  name: string
  sourcePath: string
  trashPath: string
  origin?: SkillOrigin
  contentHash?: string
}

export interface TrashSession {
  id: string
  scopeId: string
  root: string
  manifestPath: string
  reason: string
  entries: TrashEntry[]
  createdAt: string
}

/** 用临时 session 包装回收站；只有真正移动旧目录时才创建 manifest。 */
export function createTrashSession(root: string, id: string, scopeId: string, reason: string): TrashSession {
  return {
    id,
    scopeId,
    root: join(root, id),
    manifestPath: join(root, id, 'manifest.json'),
    reason,
    entries: [],
    createdAt: new Date().toISOString(),
  }
}

export async function moveToTrash(
  session: TrashSession,
  sourcePath: string,
  name: string,
  origin?: SkillOrigin,
  contentHash?: string,
): Promise<TrashEntry> {
  await mkdir(session.root, { recursive: true })
  const trashPath = join(session.root, safePart(name))
  if (await exists(trashPath)) throw new InstallTransactionError('trash-collision', `回收站目标已存在：${name}`)
  try {
    await rename(sourcePath, trashPath)
  }
  catch (error) {
    if (!isCrossDevice(error)) throw error
    await copyTreeSafe(sourcePath, trashPath)
    await rm(sourcePath, { recursive: true, force: true })
  }
  const entry: TrashEntry = { name, sourcePath, trashPath, origin, contentHash }
  session.entries.push(entry)
  await writeManifest(session)
  return entry
}

export async function restoreTrashEntry(entry: TrashEntry): Promise<void> {
  if (await exists(entry.sourcePath)) {
    throw new InstallTransactionError('restore-conflict', `恢复目标已存在：${entry.sourcePath}`)
  }
  await mkdir(join(entry.sourcePath, '..'), { recursive: true })
  try {
    await rename(entry.trashPath, entry.sourcePath)
  }
  catch (error) {
    if (!isCrossDevice(error)) throw error
    await copyTreeSafe(entry.trashPath, entry.sourcePath)
    await rm(entry.trashPath, { recursive: true, force: true })
  }
}

export async function writeManifest(session: TrashSession): Promise<void> {
  await mkdir(session.root, { recursive: true })
  const payload = {
    version: 1 as const,
    id: session.id,
    scopeId: session.scopeId,
    reason: session.reason,
    createdAt: session.createdAt,
    entries: session.entries.map(entry => ({
      name: entry.name,
      sourcePath: entry.sourcePath,
      trashPath: entry.trashPath,
      origin: entry.origin,
      contentHash: entry.contentHash,
    })),
  }
  await writeFile(session.manifestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

/** 复制目录；拒绝符号链接，跳过 .git / node_modules / 临时目录。 */
export async function copyTreeSafe(from: string, to: string): Promise<void> {
  const info = await lstat(from)
  if (info.isSymbolicLink()) throw new InstallTransactionError('unsafe-symlink', `拒绝复制符号链接：${basename(from)}`)
  if (info.isFile()) {
    await mkdir(join(to, '..'), { recursive: true })
    await cp(from, to)
    return
  }
  if (!info.isDirectory()) throw new InstallTransactionError('unsupported-file', `不支持的文件类型：${basename(from)}`)
  await mkdir(to, { recursive: true })
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.skill-manager-') || SKIP_NAMES.has(entry.name) || entry.name === '.DS_Store') continue
    await copyTreeSafe(join(from, entry.name), join(to, entry.name))
  }
}

/** 在目标根下先复制到临时目录，再同盘 rename；失败时清掉临时目录。 */
export async function commitStagedDirectory(stagingDir: string, targetRoot: string, name: string, operationId: string): Promise<string> {
  await mkdir(targetRoot, { recursive: true })
  const target = join(targetRoot, name)
  if (await exists(target)) throw new InstallTransactionError('target-exists', `目标已存在：${name}`)
  const temp = join(targetRoot, `.skill-manager-tmp-${operationId}-${safePart(name)}`)
  if (await exists(temp)) await rm(temp, { recursive: true, force: true })
  try {
    await copyTreeSafe(stagingDir, temp)
    await rename(temp, target)
  }
  catch (error) {
    await rm(temp, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  return target
}

/** 原样原子写回文本；撤销时用于恢复历史锁的字节快照。 */
export async function writeTextAtomic(path: string, raw: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.skill-manager-write-${process.pid}-${Date.now()}`
  try {
    await writeFile(temp, raw, 'utf8')
    await rename(temp, path)
  }
  catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
}

export async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  }
  catch {
    return false
  }
}

export function fingerprint(raw: string): string {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

function safePart(value: string): string {
  return value.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'skill'
}

function isCrossDevice(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EXDEV'
}
