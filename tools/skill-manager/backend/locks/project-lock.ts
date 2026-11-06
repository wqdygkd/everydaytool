import type {
  LockReadFailure,
  LockReadResult,
  ProjectLockEntry,
  ProjectLockFile,
} from '../../../../shared/skill-manager.ts'
import { createHash } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { emptyProjectLock, PROJECT_LOCK_VERSION } from '../../../../shared/skill-manager.ts'
import { isRecord, readTextIfExists, stripBom } from './lock-file.ts'

export function getProjectLockPath(projectPath: string): string {
  return join(projectPath, 'skills-lock.json')
}

export class ProjectLockWriteError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ProjectLockWriteError'
    this.code = code
  }
}

export interface ProjectLockWriteOptions {
  operationId: string
  /** 写锁前快照目录；生产环境为 config/skill-manager/lock-backups。 */
  backupRoot: string
  /** 读取锁时的原始文本；缺省表示不检查并发修改。 */
  expectedRaw?: string
  /** 读取锁时的指纹；与 expectedRaw 二选一。 */
  expectedFingerprint?: string
}

export interface ProjectLockWriteResult {
  path: string
  raw: string
  fingerprint: string
  backupPath?: string
}

function hashRaw(raw: string): string {
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`
}

/** 原子写项目锁；写前按指纹校验，并把旧文本快照到 lock-backups/<operationId>.json。 */
export async function writeProjectLock(
  lock: ProjectLockFile,
  projectPath: string,
  options: ProjectLockWriteOptions,
): Promise<ProjectLockWriteResult> {
  if (lock.version !== PROJECT_LOCK_VERSION) {
    throw new ProjectLockWriteError('unsupported-version', `只能写项目锁 v${PROJECT_LOCK_VERSION}`)
  }
  const path = getProjectLockPath(projectPath)
  const current = await readTextIfExists(path)
  const currentRaw = current.exists ? current.text : ''
  const currentFingerprint = hashRaw(currentRaw)

  if (options.expectedRaw !== undefined && currentRaw !== options.expectedRaw) {
    throw new ProjectLockWriteError('lock-changed', 'skills-lock.json 在安装过程中被修改，已取消写入')
  }
  if (options.expectedFingerprint !== undefined && currentFingerprint !== options.expectedFingerprint) {
    throw new ProjectLockWriteError('lock-changed', 'skills-lock.json 指纹已变化，请刷新后重试')
  }

  await mkdir(projectPath, { recursive: true })
  let backupPath: string | undefined
  if (current.exists) {
    await mkdir(options.backupRoot, { recursive: true })
    backupPath = join(options.backupRoot, `${safePart(options.operationId)}.json`)
    await writeFile(backupPath, current.text, 'utf8')
  }

  const raw = formatProjectLock(lock)
  const temp = join(projectPath, `.skills-lock.json.tmp-${process.pid}-${Date.now()}`)
  try {
    await writeFile(temp, raw, { encoding: 'utf8', mode: 0o644 })
    await rename(temp, path)
  }
  catch (error) {
    await rm(temp, { force: true }).catch(() => {})
    throw error
  }
  return { path, raw, fingerprint: hashRaw(raw), backupPath }
}

function safePart(value: string): string {
  return value.replace(/[^\w.-]+/g, '_').slice(0, 100) || 'lock'
}

function invalid(path: string, message: string, raw?: string): LockReadFailure {
  return { ok: false, path, reason: 'invalid', message, raw }
}

function unsupported(path: string, version: number, message: string, raw: string): LockReadFailure {
  return { ok: false, path, reason: 'unsupported', message, version, raw }
}

function validateEntry(value: unknown): value is ProjectLockEntry {
  if (!isRecord(value)) return false
  return typeof value.source === 'string'
    && typeof value.sourceType === 'string'
    && typeof value.computedHash === 'string'
}

/** 只解析项目锁 v1；未知字段保留在返回对象里。 */
export function parseProjectLock(raw: string, path = '<memory>'): LockReadResult<ProjectLockFile> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(raw))
  } catch (error) {
    return invalid(path, `JSON 解析失败：${(error as Error).message}`, raw)
  }

  if (!isRecord(parsed) || typeof parsed.version !== 'number' || !isRecord(parsed.skills)) {
    return invalid(path, '缺少 version 或 skills 对象', raw)
  }

  if (parsed.version !== PROJECT_LOCK_VERSION) {
    return unsupported(path, parsed.version, `不支持的 skills-lock.json 版本：${parsed.version}（期望 ${PROJECT_LOCK_VERSION}）`, raw)
  }

  for (const [name, entry] of Object.entries(parsed.skills)) {
    if (!validateEntry(entry)) {
      return invalid(path, `技能「${name}」缺少 source / sourceType / computedHash`, raw)
    }
  }

  return {
    ok: true,
    path,
    exists: true,
    raw,
    data: parsed as ProjectLockFile,
  }
}

export async function readProjectLock(projectPath: string): Promise<LockReadResult<ProjectLockFile>> {
  const path = getProjectLockPath(projectPath)
  try {
    const read = await readTextIfExists(path)
    if (!read.exists) {
      return { ok: true, path, exists: false, raw: '', data: emptyProjectLock() }
    }
    return parseProjectLock(read.text, path)
  } catch (error) {
    return { ok: false, path, reason: 'io', message: (error as Error).message }
  }
}

/**
 * 项目锁的规范文本：技能名排序、2 空格缩进、结尾换行。
 * 只用于测试/未来的写回；本步骤不调用写文件。
 */
export function formatProjectLock(lock: ProjectLockFile): string {
  const sorted = Object.fromEntries(
    Object.keys(lock.skills)
      .sort()
      .map(name => [name, lock.skills[name]]),
  )
  return `${JSON.stringify({ ...lock, skills: sorted }, null, 2)}\n`
}
