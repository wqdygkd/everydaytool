// edt 应用级数据根目录（所有工具的配置 / 缓存 / 产出都落在其下）的唯一事实来源：
// 默认目录、用户覆盖（data-root.json 引导配置 + data-root.path 镜像文件）、setup 状态。
// 与具体工具域无关；Chrome / 沙箱专属路径见 tools/chrome-sandbox/backend/utils/path-helper.ts。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrateDataDirectory } from './data-migration.ts'
import { pathExists, readJson, removeIfExists, writeJson } from './file-ops.ts'
import { logger } from './logger.ts'

const require = createRequire(import.meta.url)
const { app } = require('electron') as typeof import('electron')

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Use app.isPackaged for reliable detection (NODE_ENV may not be set in packaged apps)
export const isDev = !app.isPackaged

// In development: source files live under tools/, compiled files under dist-electron/tools/.
const sourceRootCandidate = path.resolve(__dirname, '..', '..', '..')
export const APP_ROOT_DEV = path.basename(sourceRootCandidate) === 'dist-electron'
  ? path.dirname(sourceRootCandidate)
  : sourceRootCandidate

export function getDefaultDataDirectory(): string {
  return isDev
    ? path.join(APP_ROOT_DEV, 'data')
    : path.join(app.getPath('userData'), 'data')
}

let dataDirectoryOverride: string | null = null

function getUserDataFile(filename: string): string {
  return path.join(app.getPath('userData'), filename)
}

function getBootstrapConfigPath(): string {
  return getUserDataFile('data-root.json')
}

function getSetupStatePath(): string {
  return getUserDataFile('setup-state.json')
}

function getPendingConfigPath(): string {
  return getUserDataFile('data-root.pending.json')
}

function getCustomDataPathFile(): string {
  return getUserDataFile('data-root.path')
}

async function updateCustomDataPathFile(customDirectory: string | null): Promise<void> {
  const pathFile = getCustomDataPathFile()
  if (!customDirectory) {
    await removeIfExists(pathFile)
    return
  }

  if (await pathExists(pathFile)) {
    const existing = (await readFile(pathFile, 'utf8')).trim()
    if (existing === customDirectory) return
  }

  await writeFile(pathFile, customDirectory, 'utf8')
}

export async function isDataDirectoryConfigured(): Promise<boolean> {
  const setupPath = getSetupStatePath()
  if (await pathExists(setupPath)) {
    try {
      const state = await readJson<{ dataDirectoryConfigured?: boolean }>(setupPath)
      return state.dataDirectoryConfigured === true
    } catch (error) {
      logger.warn('Failed to read setup state', { error: (error as Error).message })
    }
  }

  return pathExists(getBootstrapConfigPath())
}

export async function markDataDirectoryConfigured(): Promise<void> {
  const setupPath = getSetupStatePath()
  await writeJson(setupPath, { dataDirectoryConfigured: true })
}

function setDataDirectoryOverride(dir: string | null): void {
  dataDirectoryOverride = normalizeDataDirectory(dir)
}

function isSameDataDirectory(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b)
}

function isNestedDataDirectory(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * 请求切换数据目录：只写入 pending 标记，不立即切换。
 * 下次启动会在 ready 之前把旧目录整体迁移到新目录，再指向新目录——
 * 这样 sessionData 与各工具缓存都能保持有效。
 */
export async function requestDataDirectoryChange(
  nextDirectory: string,
): Promise<{ dataDirectory: string, pendingDataDirectory: string | null, changed: boolean }> {
  const normalized = normalizeDataDirectory(nextDirectory) || getDefaultDataDirectory()
  const current = getDataDirectory()
  if (isSameDataDirectory(normalized, current)) {
    await removeIfExists(getPendingConfigPath())
    return { dataDirectory: current, pendingDataDirectory: null, changed: false }
  }
  if (isNestedDataDirectory(current, normalized) || isNestedDataDirectory(normalized, current)) {
    throw new Error('新旧数据目录不能互相嵌套')
  }
  if (existsSync(normalized) && readdirSync(normalized).length > 0) {
    throw new Error('目标目录非空，请选择一个空目录（迁移不会覆盖已有文件）')
  }

  await writeJson(getPendingConfigPath(), { dataDirectory: normalized })
  logger.info('Data directory change requested; migration will run on next launch', {
    from: current,
    to: normalized,
  })
  return { dataDirectory: current, pendingDataDirectory: normalized, changed: true }
}

export function getPendingDataDirectory(): string | null {
  const pendingPath = getPendingConfigPath()
  try {
    if (!existsSync(pendingPath)) return null
    const raw = JSON.parse(readFileSync(pendingPath, 'utf8')) as { dataDirectory?: unknown }
    return typeof raw.dataDirectory === 'string' ? normalizeDataDirectory(raw.dataDirectory) : null
  } catch {
    return null
  }
}

function saveDataDirectoryOverrideSync(directory: string | null): void {
  const bootstrapPath = getBootstrapConfigPath()
  const customPathFile = getCustomDataPathFile()
  if (!directory) {
    rmSync(bootstrapPath, { force: true })
    rmSync(customPathFile, { force: true })
    return
  }
  mkdirSync(path.dirname(bootstrapPath), { recursive: true })
  const tmp = `${bootstrapPath}.${Date.now()}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ dataDirectory: directory }, null, 2)}\n`, 'utf8')
  renameSync(tmp, bootstrapPath)
  writeFileSync(customPathFile, directory, 'utf8')
}

function clearPendingConfigSync(): void {
  rmSync(getPendingConfigPath(), { force: true })
}

export function normalizeDataDirectory(dir: string | null | undefined): string | null {
  if (!dir || !String(dir).trim()) return null
  return path.resolve(String(dir).trim())
}

export function getDataDirectory(): string {
  return dataDirectoryOverride || getDefaultDataDirectory()
}

async function syncCustomDataPathFile(): Promise<void> {
  await updateCustomDataPathFile(dataDirectoryOverride)
}

export async function loadDataDirectoryOverride(): Promise<void> {
  const bootstrapPath = getBootstrapConfigPath()
  try {
    if (!await pathExists(bootstrapPath)) return
    const { dataDirectory } = await readJson<{ dataDirectory?: string }>(bootstrapPath)
    setDataDirectoryOverride(normalizeDataDirectory(dataDirectory))
  } catch (error) {
    logger.warn('Failed to load data directory override', { error: (error as Error).message })
  } finally {
    await syncCustomDataPathFile()
  }
}

/**
 * 同步版本：供 `ready` 之前设置 sessionData 使用（异步读取可能晚于 ready）。
 * 若存在 pending 目录，先完成整体迁移再切换；迁移失败则继续使用旧目录。
 */
export function loadDataDirectoryOverrideSync(): void {
  const bootstrapPath = getBootstrapConfigPath()
  try {
    if (existsSync(bootstrapPath)) {
      const raw = JSON.parse(readFileSync(bootstrapPath, 'utf8')) as { dataDirectory?: unknown }
      if (typeof raw.dataDirectory === 'string') {
        setDataDirectoryOverride(normalizeDataDirectory(raw.dataDirectory))
      }
    }
  } catch (error) {
    logger.warn('Failed to load data directory override synchronously', { error: (error as Error).message })
  }

  const pending = getPendingDataDirectory()
  if (!pending) return
  if (isSameDataDirectory(pending, getDataDirectory())) {
    clearPendingConfigSync()
    return
  }

  const result = migrateDataDirectory(getDataDirectory(), pending)
  if (!result.ok) {
    logger.warn('Pending data directory migration failed; keeping current directory', {
      pending,
      error: result.error,
    })
    return
  }

  const bootstrapTarget = isSameDataDirectory(pending, getDefaultDataDirectory()) ? null : pending
  saveDataDirectoryOverrideSync(bootstrapTarget)
  clearPendingConfigSync()
  setDataDirectoryOverride(bootstrapTarget)
  logger.info('Data directory switch completed', { dataDirectory: getDataDirectory(), pending })
}
