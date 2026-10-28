// 应用壳的 UI 偏好（配置层：`<data>/config/app/ui-preferences.json`）。
//
// 目前只有「收藏的工具」：它是用户数据（用户手动标记、换机后希望保留、应进备份包），
// 所以从 Chromium 的 LocalStorage（会话层，不备份、可能随清 session 丢失）搬到配置层。
// LocalStorage 仍保留镜像，给网页预览（无 IPC）兜底。
import type { UiPreferences } from '../../shared/app.ts'
import { resolveLayerPath } from './data-layers.ts'
import { readJsonDocument, writeJsonDocument } from './json-store.ts'
import { logger } from './logger.ts'

const MAX_FAVORITES = 200
const EMPTY: UiPreferences = { favoriteToolIds: [] }

function getPreferencesPath(): string {
  return resolveLayerPath('config', 'app', 'ui-preferences.json')
}

/** 渲染层传上来的数组不可信：只保留非空字符串，去重并限量 */
function sanitizeFavoriteIds(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const ids: string[] = []
  for (const item of input) {
    if (typeof item !== 'string' || !item.trim()) continue
    const id = item.trim()
    if (!ids.includes(id)) ids.push(id)
    if (ids.length >= MAX_FAVORITES) break
  }
  return ids
}

export function getUiPreferences(): UiPreferences {
  const stored = readJsonDocument<unknown>(getPreferencesPath(), () => ({ ...EMPTY }))
  if (typeof stored !== 'object' || stored === null) return { ...EMPTY }
  const record = stored as Record<string, unknown>
  return { favoriteToolIds: sanitizeFavoriteIds(record.favoriteToolIds) }
}

export function setUiPreferences(patch: { favoriteToolIds?: unknown }): UiPreferences {
  const next: UiPreferences = {
    favoriteToolIds: patch.favoriteToolIds === undefined
      ? getUiPreferences().favoriteToolIds
      : sanitizeFavoriteIds(patch.favoriteToolIds),
  }
  writeJsonDocument(getPreferencesPath(), next)
  logger.info('UI preferences saved', { favorites: next.favoriteToolIds.length })
  return next
}
