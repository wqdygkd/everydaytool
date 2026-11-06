import type {
  GlobalLockEntry,
  GlobalLockFile,
  LockReadFailure,
  LockReadResult,
} from '../../../../shared/skill-manager.ts'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { emptyGlobalLock, GLOBAL_LOCK_VERSION } from '../../../../shared/skill-manager.ts'
import { isRecord, readTextIfExists, stripBom } from './lock-file.ts'

export function getGlobalLockPath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME
  if (xdgStateHome) {
    return join(xdgStateHome, 'skills', '.skill-lock.json')
  }
  return join(homedir(), '.agents', '.skill-lock.json')
}

function invalid(path: string, message: string, raw?: string): LockReadFailure {
  return { ok: false, path, reason: 'invalid', message, raw }
}

function unsupported(path: string, version: number, message: string, raw: string): LockReadFailure {
  return { ok: false, path, reason: 'unsupported', message, version, raw }
}

function validateEntry(value: unknown): value is GlobalLockEntry {
  if (!isRecord(value)) return false
  return typeof value.source === 'string'
    && typeof value.sourceType === 'string'
    && typeof value.skillFolderHash === 'string'
}

/**
 * 只解析全局锁 v3。v1/v2 会被 CLI 直接清空，因此应用侧也不把它们当有效数据；
 * 未知版本一律只读拒绝，绝不写回。
 */
export function parseGlobalLock(raw: string, path = '<memory>'): LockReadResult<GlobalLockFile> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(raw))
  } catch (error) {
    return invalid(path, `JSON 解析失败：${(error as Error).message}`, raw)
  }

  if (!isRecord(parsed) || typeof parsed.version !== 'number' || !isRecord(parsed.skills)) {
    return invalid(path, '缺少 version 或 skills 对象', raw)
  }

  if (parsed.version !== GLOBAL_LOCK_VERSION) {
    return unsupported(
      path,
      parsed.version,
      `全局锁版本 ${parsed.version} 不受支持；本工具只读写 v${GLOBAL_LOCK_VERSION}，旧版会被 CLI 清空`,
      raw,
    )
  }

  for (const [name, entry] of Object.entries(parsed.skills)) {
    if (!validateEntry(entry)) {
      return invalid(path, `技能「${name}」缺少 source / sourceType / skillFolderHash`, raw)
    }
  }

  return {
    ok: true,
    path,
    exists: true,
    raw,
    data: parsed as GlobalLockFile,
  }
}

export async function readGlobalLock(path = getGlobalLockPath()): Promise<LockReadResult<GlobalLockFile>> {
  try {
    const read = await readTextIfExists(path)
    if (!read.exists) {
      return { ok: true, path, exists: false, raw: '', data: emptyGlobalLock() }
    }
    return parseGlobalLock(read.text, path)
  } catch (error) {
    return { ok: false, path, reason: 'io', message: (error as Error).message }
  }
}

/**
 * 全局锁的规范文本：CLI 用 JSON.stringify(lock, null, 2)，没有尾换行。
 */
export function formatGlobalLock(lock: GlobalLockFile): string {
  return JSON.stringify(lock, null, 2)
}

/** 原子写入全局锁；绝不写 v1/v2，调用方必须先通过 readGlobalLock 校验版本。 */
export async function writeGlobalLock(lock: GlobalLockFile, path = getGlobalLockPath()): Promise<string> {
  if (lock.version !== GLOBAL_LOCK_VERSION) {
    throw new Error(`拒绝写入全局锁 v${lock.version}；CLI 会清空旧版本数据`)
  }
  const raw = formatGlobalLock(lock)
  const tempPath = `${path}.${process.pid}.tmp`
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(tempPath, raw, 'utf8')
    await rename(tempPath, path)
  }
  catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
  return raw
}
