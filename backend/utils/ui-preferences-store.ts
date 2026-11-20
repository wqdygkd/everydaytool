// 应用壳的 UI 偏好（配置层：`<data>/config/app/ui-preferences.json`）。
//
// 目前有两项用户数据：
// - 首页工具的自定义顺序（拖拽卡片产生，空数组 = 按创建时间倒序）。
// - 左轨三态（图标栏 / 宽栏 / 收起）。
// 两者都是用户手动排布 / 选择、换机后希望保留、应进备份包的数据，因此落在配置层。
// LocalStorage 仅作网页预览（无 IPC）的镜像。
import type { RailMode, UiPreferences } from '../../shared/app.ts'
import { isRailMode } from '../../shared/app.ts'
import { resolveLayerPath } from './data-layers.ts'
import { readJsonDocument, writeJsonDocument } from './json-store.ts'
import { logger } from './logger.ts'

const MAX_TOOL_ORDER = 200

function emptyPreferences(): UiPreferences {
  return { toolOrder: [], railMode: 'compact' }
}

function getPreferencesPath(): string {
  return resolveLayerPath('config', 'app', 'ui-preferences.json')
}

/** 渲染层传上来的数组不可信：只保留非空字符串，去重并限量 */
function sanitizeIdList(input: unknown, limit: number): string[] {
  if (!Array.isArray(input)) return []
  const ids: string[] = []
  for (const item of input) {
    if (typeof item !== 'string' || !item.trim()) continue
    const id = item.trim()
    if (!ids.includes(id)) ids.push(id)
    if (ids.length >= limit) break
  }
  return ids
}

function sanitizeRailMode(input: unknown): RailMode {
  return isRailMode(input) ? input : 'compact'
}

export function getUiPreferences(): UiPreferences {
  const stored = readJsonDocument<unknown>(getPreferencesPath(), emptyPreferences)
  if (typeof stored !== 'object' || stored === null) return emptyPreferences()
  const record = stored as Record<string, unknown>
  return {
    toolOrder: sanitizeIdList(record.toolOrder, MAX_TOOL_ORDER),
    railMode: sanitizeRailMode(record.railMode),
  }
}

export function setUiPreferences(patch: { toolOrder?: unknown, railMode?: unknown }): UiPreferences {
  const current = getUiPreferences()
  const next: UiPreferences = {
    toolOrder: patch.toolOrder === undefined
      ? current.toolOrder
      : sanitizeIdList(patch.toolOrder, MAX_TOOL_ORDER),
    railMode: patch.railMode === undefined
      ? current.railMode
      : sanitizeRailMode(patch.railMode),
  }
  writeJsonDocument(getPreferencesPath(), next)
  logger.info('UI preferences saved', {
    toolOrder: next.toolOrder.length,
    railMode: next.railMode,
  })
  return next
}
