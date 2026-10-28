// 应用壳的 UI 偏好（配置层：`<data>/config/app/ui-preferences.json`）。
//
// 目前有两项用户数据：
// - 收藏的工具；
// - 首页工具的自定义顺序（拖拽卡片产生，空数组 = 按创建时间倒序）。
// 两者都是用户手动标记 / 排布、换机后希望保留、应进备份包的数据，因此从 Chromium 的
// LocalStorage（会话层，不备份、可能随清 session 丢失）搬到配置层。
// LocalStorage 仍保留镜像，给网页预览（无 IPC）兜底。
import type { UiPreferences } from '../../shared/app.ts'
import { resolveLayerPath } from './data-layers.ts'
import { readJsonDocument, writeJsonDocument } from './json-store.ts'
import { logger } from './logger.ts'

const MAX_FAVORITES = 200
const MAX_TOOL_ORDER = 200

function emptyPreferences(): UiPreferences {
  return { favoriteToolIds: [], toolOrder: [] }
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

export function getUiPreferences(): UiPreferences {
  const stored = readJsonDocument<unknown>(getPreferencesPath(), emptyPreferences)
  if (typeof stored !== 'object' || stored === null) return emptyPreferences()
  const record = stored as Record<string, unknown>
  return {
    favoriteToolIds: sanitizeIdList(record.favoriteToolIds, MAX_FAVORITES),
    toolOrder: sanitizeIdList(record.toolOrder, MAX_TOOL_ORDER),
  }
}

export function setUiPreferences(patch: { favoriteToolIds?: unknown, toolOrder?: unknown }): UiPreferences {
  const current = getUiPreferences()
  const next: UiPreferences = {
    favoriteToolIds: patch.favoriteToolIds === undefined
      ? current.favoriteToolIds
      : sanitizeIdList(patch.favoriteToolIds, MAX_FAVORITES),
    toolOrder: patch.toolOrder === undefined
      ? current.toolOrder
      : sanitizeIdList(patch.toolOrder, MAX_TOOL_ORDER),
  }
  writeJsonDocument(getPreferencesPath(), next)
  logger.info('UI preferences saved', {
    favorites: next.favoriteToolIds.length,
    toolOrder: next.toolOrder.length,
  })
  return next
}
