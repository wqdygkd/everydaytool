// 窗口大小 / 位置的持久化：写在数据目录的 app/window-bounds.json。
// 与外观配置同理，属平台级应用壳状态（数据目录在 ready 之前已同步加载，创建窗口前可取）。
//
// 这里走同步 JSON 存储（backend/utils/json-store.ts）而不是外观那套异步写：
// resize / move 是高频事件，且关窗时必须在进程退出前完成落盘——异步写没有机会跑完。
import type { WindowBounds, WindowBoundsState } from '../../shared/window-bounds.ts'
import path from 'node:path'
import { DEFAULT_WINDOW_BOUNDS_STATE, sanitizeWindowBoundsState } from '../../shared/window-bounds.ts'
import { getDataDirectory } from './data-root.ts'
import { readJsonDocument, writeJsonDocument } from './json-store.ts'
import { logger } from './logger.ts'

const FILENAME = 'window-bounds.json'

function getConfigPath(): string {
  return path.join(getDataDirectory(), 'app', FILENAME)
}

let current: WindowBoundsState = { ...DEFAULT_WINDOW_BOUNDS_STATE }

function isSameBounds(a: WindowBounds | null, b: WindowBounds | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** 落盘失败只告警：记住窗口位置不值得打断启动 / 拖动窗口 */
function persist(next: WindowBoundsState): WindowBoundsState {
  current = next
  try {
    writeJsonDocument(getConfigPath(), next)
  } catch (error) {
    logger.warn('Failed to persist window bounds', { error: (error as Error).message })
  }
  return current
}

/** 启动时调用一次（必须在 createWindow 之前）：读坏了就退回默认（记住功能开启、但无记录） */
export function loadWindowBounds(): WindowBoundsState {
  const stored = readJsonDocument<unknown>(getConfigPath(), () => ({ ...DEFAULT_WINDOW_BOUNDS_STATE }))
  current = sanitizeWindowBoundsState(stored)
  return current
}

export function getWindowBoundsState(): WindowBoundsState {
  return current
}

/**
 * 记录普通态几何 + 最大化标记。
 * 关闭记忆功能时直接跳过（既不恢复也不写盘）；值没变化也不写——
 * move / resize 会在拖动过程中连续触发，去重后一次拖动只落一次文件。
 */
export function recordWindowBounds(bounds: WindowBounds, maximized: boolean): void {
  if (!current.enabled) return
  if (current.maximized === maximized && isSameBounds(current.bounds, bounds)) return
  persist({ ...current, maximized, bounds })
}

/** 记忆开关：只改开关，保留已记录的几何（重新开启时还能接着用） */
export function setWindowBoundsEnabled(enabled: boolean): WindowBoundsState {
  if (current.enabled === enabled) return current
  return persist({ ...current, enabled })
}

/** 重置：清掉几何记录（下次启动回到默认尺寸居中）；开关本身保持不变 */
export function clearWindowBoundsGeometry(): WindowBoundsState {
  if (!current.bounds && !current.maximized) return current
  return persist({ ...current, maximized: false, bounds: null })
}
