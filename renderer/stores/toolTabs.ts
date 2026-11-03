import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { STORAGE_KEYS } from '../../shared/storage-keys'
import { findAppTab } from '../config/app-tabs'
import { getToolRegistry } from '../config/tools'

export interface ToolTab {
  id: string
  name: string
  routeName: string
}

const STORAGE_KEY = STORAGE_KEYS.toolTabs

/** 页签可能来自工具注册表，也可能是应用自带页面（设置等）：两者共用同一套打开 / 高亮逻辑 */
function resolveTab(id: string): ToolTab | null {
  const tool = getToolRegistry().find(t => t.id === id)
  if (tool) return { id: tool.id, name: tool.name, routeName: `tool-${tool.id}` }
  const appTab = findAppTab(id)
  return appTab ? { id: appTab.id, name: appTab.name, routeName: appTab.routeName } : null
}

export const useToolTabsStore = defineStore('toolTabs', () => {
  // 隐私模式 / 配额满：持久化失败不影响当前会话的页签行为
  const openIds = useLocalStorage<string[]>(STORAGE_KEY, [], {
    serializer: {
      read(raw) {
        const value = JSON.parse(raw) as unknown
        return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
      },
      write: value => JSON.stringify(value),
    },
    writeDefaults: false,
    onError: () => {},
  })
  const activeId = ref<string | null>(null)

  const openTabs = computed<ToolTab[]>(() =>
    openIds.value
      .map(resolveTab)
      .filter((tab): tab is ToolTab => tab !== null),
  )

  function close(toolId: string) {
    const idx = openIds.value.indexOf(toolId)
    if (idx === -1) return
    openIds.value.splice(idx, 1)
    // 不自动切到相邻页签：关闭正在查看的工具后由调用方决定去向（当前约定：回主页）
    if (activeId.value === toolId) {
      activeId.value = null
    }
  }

  function syncFromRoute(toolId: string | null) {
    // activeId 镜像当前路由：回到主页（toolId 为空）即清空，保证页签高亮永不残留
    if (!toolId) {
      activeId.value = null
      return
    }
    if (!openIds.value.includes(toolId)) {
      openIds.value.push(toolId)
    }
    activeId.value = toolId
  }

  /**
   * 拖拽后按新顺序重排已打开的页签（只接受当前 id 集合的一个完整排列）。
   * 页签顺序属于会话层数据，沿用 localStorage 持久化（与打开 / 关闭一致）。
   */
  function reorder(ids: string[]) {
    if (ids.length !== openIds.value.length) return
    const current = new Set(openIds.value)
    const next = new Set(ids)
    if (next.size !== ids.length || !ids.every(id => current.has(id))) return
    openIds.value = [...ids]
  }

  // 上次会话残留的 id（工具被移除 / 应用页改名）在此清理：页签必须能解析出名字与路由，
  // 否则用户点击页签时会落到不存在的组件。
  const validIds = openIds.value.filter(id => resolveTab(id) !== null)
  if (validIds.length !== openIds.value.length) {
    openIds.value = validIds
  }

  return {
    openIds,
    activeId,
    openTabs,
    close,
    syncFromRoute,
    reorder,
  }
})
