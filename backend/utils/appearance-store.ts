// 窗口外观设置的持久化：写在数据目录的 app/window-appearance.json。
// 数据目录在 main 的 ready 之前已同步加载，因此创建窗口前可以拿到它。
// 与具体工具域无关，属平台级应用壳配置。
import type { WindowAppearance, WindowAppearanceUpdate } from '../../shared/appearance.ts'
import { copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { DEFAULT_WINDOW_APPEARANCE, sanitizeWindowAppearance } from '../../shared/appearance.ts'
import { getDataDirectory } from './data-root.ts'
import { pathExists, readJson, writeJson } from './file-ops.ts'
import { logger } from './logger.ts'

const require = createRequire(import.meta.url)
const { app } = require('electron') as typeof import('electron')

const FILENAME = 'window-appearance.json'

function getConfigPath(): string {
  return path.join(getDataDirectory(), 'app', FILENAME)
}

function getLegacyConfigPath(): string {
  return path.join(app.getPath('userData'), FILENAME)
}

/** 与平台无关的默认值：真正生效前还要过 sanitizeWindowAppearance 按平台裁剪 */
let current: WindowAppearance = { ...DEFAULT_WINDOW_APPEARANCE }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 只接受布尔 / 已知字符串，其余字段回落默认值（配置文件可能被手改坏） */
function normalizeStored(value: unknown): WindowAppearance {
  if (!isRecord(value)) return { ...DEFAULT_WINDOW_APPEARANCE }
  const materials = ['none', 'mica', 'acrylic', 'tabbed']
  const vibrancies = ['none', 'sidebar', 'hud', 'under-window', 'fullscreen-ui']
  const material = typeof value.material === 'string' && materials.includes(value.material)
    ? value.material as WindowAppearance['material']
    : 'none'
  const vibrancy = typeof value.vibrancy === 'string' && vibrancies.includes(value.vibrancy)
    ? value.vibrancy as WindowAppearance['vibrancy']
    : 'none'
  return {
    enabled: value.enabled === true,
    material,
    vibrancy,
    testWallpaper: value.testWallpaper === true,
  }
}

/** 早期版本在 userData；首次读取时搬到数据目录 */
async function migrateLegacyAppearance(): Promise<void> {
  const target = getConfigPath()
  const legacy = getLegacyConfigPath()
  if (await pathExists(target) || !await pathExists(legacy)) return
  try {
    await mkdir(path.dirname(target), { recursive: true })
    try {
      await rename(legacy, target)
    } catch {
      await copyFile(legacy, target)
      await rm(legacy, { force: true })
    }
    logger.info('Window appearance moved to data directory')
  } catch (error) {
    logger.warn('Failed to move window appearance', { error: (error as Error).message })
  }
}

/** 启动时调用一次：读盘失败不影响应用启动（退回默认外观） */
export async function loadWindowAppearance(): Promise<WindowAppearance> {
  await migrateLegacyAppearance()
  try {
    const stored = await readJson<unknown>(getConfigPath())
    current = normalizeStored(stored)
  } catch {
    current = { ...DEFAULT_WINDOW_APPEARANCE }
  }
  return current
}

export function getWindowAppearance(): WindowAppearance {
  return current
}

/**
 * 合并补丁并落盘；返回按平台裁剪后的最终值。
 * 平台不支持时 silent 降级（不抛错）：设置面板会读到 capabilities 后禁用对应选项，
 * 此处再兜底一次，保证磁盘里永远不会留下无效组合。
 */
export async function updateWindowAppearance(
  patch: WindowAppearanceUpdate,
  capabilities: Parameters<typeof sanitizeWindowAppearance>[1],
): Promise<WindowAppearance> {
  const merged: WindowAppearance = {
    ...current,
    ...patch,
    enabled: patch.enabled ?? current.enabled,
    material: patch.material ?? current.material,
    vibrancy: patch.vibrancy ?? current.vibrancy,
    testWallpaper: patch.testWallpaper ?? current.testWallpaper,
  }
  const next = sanitizeWindowAppearance(merged, capabilities)
  current = next
  try {
    await writeJson(getConfigPath(), next)
  } catch (error) {
    logger.warn('Failed to persist window appearance', { error: (error as Error).message })
  }
  return next
}
