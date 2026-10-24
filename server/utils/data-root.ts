// edt 应用级数据根目录（所有工具的数据库 / 配置 / 产出都落在其下）的唯一事实来源：
// 默认目录、用户覆盖（data-root.json 引导配置 + data-root.path 镜像文件）、setup 状态。
// 与具体工具域无关；Chrome / 沙箱专属路径见 tools/chrome-sandbox/server/utils/path-helper.ts。
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureDir, pathExists, readJson, removeIfExists, writeJson } from './file-ops.ts'
import { logger } from './logger.ts'
import { runtime } from './platform.ts'

// 打包态判定来自宿主注入（EDT_IS_PACKAGED）。
export const isDev = !runtime.isPackaged

// 开发态应用根目录：由 Rust 宿主注入项目根（打包态为可执行文件目录）。
// 不再用源码/产物的相对层级推断：Node 运行时是单文件 bundle，__dirname 不可靠。
export const APP_ROOT_DEV = runtime.appRoot

export function getDefaultDataDirectory(): string {
  return isDev
    ? path.join(APP_ROOT_DEV, 'data')
    : path.join(runtime.userDataDir, 'data')
}

let dataDirectoryOverride: string | null = null

function getUserDataFile(filename: string): string {
  return path.join(runtime.userDataDir, filename)
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
