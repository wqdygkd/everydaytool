import { defineStore } from 'pinia'
import { STORAGE_KEYS } from '../../shared/storage-keys'
import { findAppTab } from '../config/app-tabs'
import { getToolRegistry } from '../config/tools'

export interface ToolTab {
  id: string
  name: string
  routeName: string
  /**
   * 工具身份色（应用自带页面没有）：页签圆点与选中浅底取它。
   * 与首页卡片头像同一支色——「同色 = 同一个工具」是这套配色的地点感来源，
   * 见 tokens.scss 的 --tool-accent。
   */
  color?: string
}

const STORAGE_KEY = STORAGE_KEYS.toolTabs

/** 页签可能来自工具注册表，也可能是应用自带页面（设置等）：两者共用同一套打开 / 高亮逻辑 */
function resolveTab(id: string): ToolTab | null {
  const tool = getToolRegistry().find(t => t.id === id)
  if (tool) return { id: tool.id, name: tool.name, routeName: `tool-${tool.id}`, color: tool.color }
  const appTab = findAppTab(id)
  return appTab ? { id: appTab.id, name: appTab.name, routeName: appTab.routeName } : null
}

function readStored(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const v = JSON.parse(raw) as string[]
    return Array.isArray(v) ? v.filter(id => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeStored(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // 隐私模式 / 配额满：持久化失败不影响当前会话的页签行为
  }
}

export const useToolTabsStore = defineStore('toolTabs', () => {
  const openIds = ref<string[]>(readStored())
  const activeId = ref<string | null>(null)

  const openTabs = computed<ToolTab[]>(() =>
    openIds.value
      .map(resolveTab)
      .filter((tab): tab is ToolTab => tab !== null),
  )

  function persist() {
    writeStored(openIds.value)
  }

  function close(toolId: string) {
    const idx = openIds.value.indexOf(toolId)
    if (idx === -1) return
    openIds.value.splice(idx, 1)
    persist()
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
      persist()
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
    persist()
  }

  // 上次会话残留的 id（工具被移除 / 应用页改名）在此清理：页签必须能解析出名字与路由，
  // 否则常驻挂载会去渲染一个不存在的组件。
  const validIds = openIds.value.filter(id => resolveTab(id) !== null)
  if (validIds.length !== openIds.value.length) {
    openIds.value = validIds
    persist()
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
