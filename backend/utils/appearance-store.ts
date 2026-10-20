// 窗口外观设置的持久化：写在 userData 下的 window-appearance.json（与 data-root.json 同目录的
// 引导配置区），因为窗口必须在创建前就读到它——不能等后端数据目录就绪。
// 与具体工具域无关，属平台级应用壳配置。
import type { WindowAppearance, WindowAppearanceUpdate } from '../../shared/appearance.ts'
import { createRequire } from 'node:module'
import path from 'node:path'
import { DEFAULT_WINDOW_APPEARANCE, sanitizeWindowAppearance } from '../../shared/appearance.ts'
import { readJson, writeJson } from './file-ops.ts'
import { logger } from './logger.ts'

const require = createRequire(import.meta.url)
const { app } = require('electron') as typeof import('electron')

const FILENAME = 'window-appearance.json'

function getConfigPath(): string {
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

/** 启动时调用一次：读盘失败不影响应用启动（退回默认外观） */
export async function loadWindowAppearance(): Promise<WindowAppearance> {
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
