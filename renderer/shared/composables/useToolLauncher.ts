import type { UiPreferences } from '../../../shared/app'
import type { ToolDefinition } from '../types/tool'
import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'
import { STORAGE_KEYS } from '../../../shared/storage-keys'
import { getToolRegistry } from '../../config/tools'
import { appIpcChannels, invokeAppIpc } from '../ipc/useAppIpc'
import { mergeVisibleToolOrder, resolveToolOrder } from '../tool/tool-order'

const FAVORITE_STORAGE_KEY = STORAGE_KEYS.favoriteTools
const TOOL_ORDER_STORAGE_KEY = STORAGE_KEYS.homeToolOrder

function sanitizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function createStoredIdList(storageKey: string) {
  return useLocalStorage<string[]>(storageKey, [], {
    serializer: {
      read: raw => sanitizeIds(JSON.parse(raw)),
      write: ids => JSON.stringify(sanitizeIds(ids)),
    },
    writeDefaults: false,
    onError: () => {},
  })
}

// 模块级单例：AppRail、HomePage 与命令面板共享同一份置顶 / 排序状态。
const allTools = computed(() => getToolRegistry())
const favoriteIds = createStoredIdList(FAVORITE_STORAGE_KEY)
const savedToolOrder = createStoredIdList(TOOL_ORDER_STORAGE_KEY)
let syncPromise: Promise<void> | null = null

const orderedTools = computed(() => resolveToolOrder(allTools.value, savedToolOrder.value))
const favoriteTools = computed(() => orderedTools.value.filter(tool => favoriteIds.value.includes(tool.id)))
const pinnedTools = computed(() => favoriteTools.value.slice(0, 4))

async function persistPreferences(patch: Partial<UiPreferences>) {
  try {
    await invokeAppIpc<UiPreferences>(appIpcChannels().UI_PREFERENCES_SET, patch)
  } catch {
    // 纯浏览器预览没有 preload：镜像已写入，不向调用方抛错。
  }
}

function isFavorite(toolId: string): boolean {
  return favoriteIds.value.includes(toolId)
}

function toggleFavorite(toolId: string) {
  favoriteIds.value = isFavorite(toolId)
    ? favoriteIds.value.filter(id => id !== toolId)
    : [...favoriteIds.value, toolId]
  void persistPreferences({ favoriteToolIds: favoriteIds.value })
}

function commitToolOrder(visibleOrder: string[]) {
  const next = mergeVisibleToolOrder(savedToolOrder.value, visibleOrder)
  savedToolOrder.value = next
  void persistPreferences({ toolOrder: next })
}

function resetToolOrder() {
  savedToolOrder.value = []
  void persistPreferences({ toolOrder: [] })
}

async function syncPreferencesWithConfigLayer() {
  if (syncPromise) return syncPromise

  syncPromise = (async () => {
    try {
      const stored = await invokeAppIpc<UiPreferences>(appIpcChannels().UI_PREFERENCES_GET)
      const remoteFavorites = sanitizeIds(stored?.favoriteToolIds)
      if (remoteFavorites.length > 0) {
        favoriteIds.value = remoteFavorites
      } else if (favoriteIds.value.length > 0) {
        void persistPreferences({ favoriteToolIds: favoriteIds.value })
      }

      const remoteOrder = sanitizeIds(stored?.toolOrder)
      if (remoteOrder.length > 0) {
        savedToolOrder.value = remoteOrder
      } else if (savedToolOrder.value.length > 0) {
        void persistPreferences({ toolOrder: savedToolOrder.value })
      }
    } catch {
      // 纯浏览器预览：保持 LocalStorage 镜像。
    }
  })()

  return syncPromise
}

export function useToolLauncher() {
  return {
    allTools: allTools as Readonly<typeof allTools>,
    favoriteIds,
    favoriteTools,
    pinnedTools,
    orderedTools,
    savedToolOrder,
    isFavorite,
    toggleFavorite,
    commitToolOrder,
    resetToolOrder,
    syncPreferencesWithConfigLayer,
  }
}

export type LauncherTool = ToolDefinition
