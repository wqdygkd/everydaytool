// 资产根（`<assets>`）的解析与切换：**独立于数据根**的用户归档存储位置。
//
// 为什么单独一个根（docs/data-layers.md §3）：
// - 归档（telegram `archive/`）不可再生、体量大（GB~TB 级），不该被数据目录迁移整树搬运；
// - 用户希望把它放到另一块盘（移动硬盘 / 大容量分区），而数据目录留在系统盘；
// - 它仍必须"可被定位、可被备份清单引用"，所以引导文件放在 userData（与 `data-root.json` 同级、
//   随安装版 / 开发版分开），默认位置则是 `<data>/assets`。
//
// 生命周期与数据目录同构：**只写 pending，下次启动在 ready 之前迁移生效**。
// 迁移复用 `data-migration.ts`（复制 → 全部成功才删源），失败保留旧位置与 pending，下次重试。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { migrateDataDirectory } from './data-migration.ts'
import { getDataDirectory } from './data-root.ts'
import { removeIfExists, writeJson } from './file-ops.ts'
import { writeJsonDocument } from './json-store.ts'
import { logger } from './logger.ts'
import { isSafeAssetsDirectory, isSamePath, isStrictlyWithin } from './path-guard.ts'

const BOOTSTRAP_FILE = 'assets-root.json'
const PENDING_FILE = 'assets-root.pending.json'

let assetsRootOverride: string | null = null

function getUserDataFile(filename: string): string {
  return path.join(app.getPath('userData'), filename)
}

/** 默认资产根：`<data>/assets`（位于数据根内，因此会随数据目录一起迁移） */
export function getDefaultAssetsRoot(): string {
  return path.join(getDataDirectory(), 'assets')
}

/** 当前生效的资产根 */
export function getAssetsRoot(): string {
  return assetsRootOverride || getDefaultAssetsRoot()
}

export function isAssetsRootCustom(): boolean {
  return !isSamePath(getAssetsRoot(), getDefaultAssetsRoot())
}

export function normalizeAssetsRoot(dir: string | null | undefined): string | null {
  if (!dir || !String(dir).trim()) return null
  return path.resolve(String(dir).trim())
}

/**
 * 资产根与数据根的**关系**校验（位置本身合法还不够）：
 * - 不能等于数据根（否则两层混在一起，清理与备份都失去意义）；
 * - 不能把数据根套在里面（数据目录迁移会递归缠住）；
 * - 不能落在 config / session / cache 这三个层根上（资产必须自成一棵子树）。
 * 允许位于数据根内的其它位置（默认即 `<data>/assets`）。
 */
export function checkAssetsRootRelation(candidate: string): string | null {
  const resolved = path.resolve(candidate)
  const dataDirectory = getDataDirectory()
  if (isSamePath(resolved, dataDirectory)) return '资产目录不能与数据目录相同'
  if (isStrictlyWithin(resolved, dataDirectory)) return '数据目录不能位于资产目录内'
  for (const layer of ['config', 'session', 'cache']) {
    const layerRoot = path.join(dataDirectory, layer)
    if (isSamePath(resolved, layerRoot) || isStrictlyWithin(layerRoot, resolved)) {
      return `资产目录不能落在数据目录的 ${layer} 层内`
    }
  }
  return null
}

function setAssetsRootOverride(dir: string | null): void {
  assetsRootOverride = normalizeAssetsRoot(dir)
}

function saveAssetsRootSync(directory: string | null): void {
  const bootstrapPath = getUserDataFile(BOOTSTRAP_FILE)
  if (!directory) {
    rmSync(bootstrapPath, { force: true })
    return
  }
  writeJsonDocument(bootstrapPath, { assetsRoot: directory })
}

function clearPendingSync(): void {
  rmSync(getUserDataFile(PENDING_FILE), { force: true })
}

export function getPendingAssetsRoot(): string | null {
  const pendingPath = getUserDataFile(PENDING_FILE)
  try {
    if (!existsSync(pendingPath)) return null
    const raw = JSON.parse(readFileSync(pendingPath, 'utf8')) as { assetsRoot?: unknown }
    return typeof raw.assetsRoot === 'string' ? normalizeAssetsRoot(raw.assetsRoot) : null
  } catch {
    return null
  }
}

export interface AppAssetsRootState {
  assetsRoot: string
  defaultAssetsRoot: string
  isCustom: boolean
  pendingAssetsRoot: string | null
}

export function getAssetsRootState(): AppAssetsRootState {
  return {
    assetsRoot: getAssetsRoot(),
    defaultAssetsRoot: getDefaultAssetsRoot(),
    isCustom: isAssetsRootCustom(),
    pendingAssetsRoot: getPendingAssetsRoot(),
  }
}

export interface AssetsDirectoryChangeResult extends AppAssetsRootState {
  changed: boolean
}

function isDirectoryNotEmpty(directory: string): boolean {
  try {
    return readdirSync(directory).length > 0
  } catch {
    return false
  }
}

/**
 * 请求切换资产根：只写 pending，下次启动迁移后生效。
 * 目标必须为空或不存在（迁移不覆盖用户数据）；不能等于数据根，也不能把数据根套在里面。
 */
export async function requestAssetsRootChange(nextDirectory: string): Promise<AssetsDirectoryChangeResult> {
  const normalized = normalizeAssetsRoot(nextDirectory)
  if (!normalized) throw new Error('资产目录不能为空')

  const guard = isSafeAssetsDirectory(normalized)
  if (!guard.ok) throw new Error(guard.reason || '资产目录不合法')

  const current = getAssetsRoot()
  if (isSamePath(normalized, current)) {
    await removeIfExists(getUserDataFile(PENDING_FILE))
    return { ...getAssetsRootState(), assetsRoot: current, pendingAssetsRoot: null, changed: false }
  }
  const relationError = checkAssetsRootRelation(normalized)
  if (relationError) throw new Error(relationError)
  if (isDirectoryNotEmpty(normalized)) {
    throw new Error('目标目录非空，请选择一个空目录（迁移不会覆盖已有文件）')
  }

  await writeJson(getUserDataFile(PENDING_FILE), { assetsRoot: normalized })
  logger.info('Assets directory change requested; migration will run on next launch', {
    from: current,
    to: normalized,
  })
  return { ...getAssetsRootState(), assetsRoot: current, pendingAssetsRoot: normalized, changed: true }
}

/**
 * 资产根迁移：复用数据目录迁移的语义（复制全部成功才删源，失败回滚目标、保留旧位置）。
 */
export function migrateAssetsDirectory(fromDirectory: string, toDirectory: string): { ok: boolean, error?: string } {
  const from = path.resolve(fromDirectory)
  const to = path.resolve(toDirectory)
  if (isSamePath(from, to)) return { ok: true }

  const guard = isSafeAssetsDirectory(to)
  if (!guard.ok) return { ok: false, error: guard.reason || '目标资产目录不合法' }
  // pending 文件可能被手改：迁移前再校验一次两者关系
  const relationError = checkAssetsRootRelation(to)
  if (relationError) return { ok: false, error: relationError }

  if (!existsSync(from)) {
    // 旧位置还没有数据（首次使用）：直接建新目录
    try {
      mkdirSync(to, { recursive: true })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }

  const result = migrateDataDirectory(from, to)
  if (!result.ok) return { ok: false, error: result.error }
  logger.info('Assets directory migrated', { from, to, moved: result.moved.length })
  return { ok: true }
}

/**
 * 启动期调用一次（必须在 ready 之前、任何 `getAssetsRoot()` 使用之前）：
 * 读覆盖配置 → 若存在 pending 先完成迁移再切换 → 确保目录存在。
 */
export function loadAssetsRootSync(): void {
  const bootstrapPath = getUserDataFile(BOOTSTRAP_FILE)
  try {
    if (existsSync(bootstrapPath)) {
      const raw = JSON.parse(readFileSync(bootstrapPath, 'utf8')) as { assetsRoot?: unknown }
      if (typeof raw.assetsRoot === 'string') setAssetsRootOverride(normalizeAssetsRoot(raw.assetsRoot))
    }
  } catch (error) {
    logger.warn('Failed to load assets root override synchronously', { error: (error as Error).message })
  }

  const pending = getPendingAssetsRoot()
  if (pending && !isSamePath(pending, getAssetsRoot())) {
    const result = migrateAssetsDirectory(getAssetsRoot(), pending)
    if (!result.ok) {
      logger.warn('Pending assets directory migration failed; keeping current directory', {
        pending,
        error: result.error,
      })
      ensureAssetsRoot()
      return
    }
    const bootstrapTarget = isSamePath(pending, getDefaultAssetsRoot()) ? null : pending
    saveAssetsRootSync(bootstrapTarget)
    setAssetsRootOverride(bootstrapTarget)
    logger.info('Assets directory switch completed', { assetsRoot: getAssetsRoot() })
  }
  if (pending) clearPendingSync()

  ensureAssetsRoot()
}

/** 确保资产根存在（工具按需 mkdir 的兜底；失败不阻断启动） */
export function ensureAssetsRoot(): void {
  try {
    mkdirSync(getAssetsRoot(), { recursive: true })
  } catch (error) {
    logger.warn('Failed to create assets root', { assetsRoot: getAssetsRoot(), error: (error as Error).message })
  }
}
