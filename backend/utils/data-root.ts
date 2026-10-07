// edt 应用级数据根目录（所有工具的数据库 / 配置 / 产出都落在其下）的唯一事实来源：
// 默认目录、用户覆盖（data-root.json 引导配置 + data-root.path 镜像文件）、setup 状态。
// 与具体工具域无关；Chrome / 沙箱专属路径见 tools/chrome-sandbox/backend/utils/path-helper.ts。
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDir, pathExists, readJson, removeIfExists, writeJson } from './file-ops.ts'
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

export async function applyDataDirectoryChange(
  nextDirectory: string,
): Promise<{ dataDirectory: string, changed: boolean }> {
  const normalized = normalizeDataDirectory(nextDirectory) || getDefaultDataDirectory()
  await ensureDir(normalized)

  const changed = !isSameDataDirectory(normalized, getDataDirectory())
  if (!changed) {
    return { dataDirectory: normalized, changed: false }
  }

  const bootstrapTarget = isSameDataDirectory(normalized, getDefaultDataDirectory()) ? null : normalized
  await saveDataDirectoryOverride(bootstrapTarget)
  setDataDirectoryOverride(bootstrapTarget)

  return { dataDirectory: normalized, changed: true }
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

async function saveDataDirectoryOverride(dataDirectory: string | null): Promise<void> {
  const bootstrapPath = getBootstrapConfigPath()
  await ensureDir(path.dirname(bootstrapPath))

  if (!dataDirectory) {
    await removeIfExists(bootstrapPath)
    await updateCustomDataPathFile(null)
    return
  }

  await writeJson(bootstrapPath, { dataDirectory })
  await updateCustomDataPathFile(dataDirectory)
}

export function getDatabasePath(): string {
  return path.join(getDataDirectory(), 'config.db')
}
