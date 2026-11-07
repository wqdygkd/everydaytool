import type { IconName } from '../shared/components/ui/icons'
import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { STORAGE_KEYS } from '../../shared/storage-keys'
import { getToolRegistry } from '../config/tools'

/**
 * 一个「已打开的工具」。标题栏与左轨都从这里取图标 / 名称 / 说明，
 * 因此它必须自带元数据，而不是让消费方各自去注册表里查。
 */
export interface OpenTool {
  id: string
  name: string
  description: string
  icon: IconName
  routeName: string
}

const STORAGE_KEY = STORAGE_KEYS.toolTabs
/** 最近使用栈上限：只用于「关闭当前工具后切到哪个」，不需要无限增长 */
const RECENT_LIMIT = 20

function resolveTool(id: string): OpenTool | null {
  const tool = getToolRegistry().find(t => t.id === id)
  if (!tool) return null
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    icon: tool.icon,
    routeName: `tool-${tool.id}`,
  }
}

/**
 * 已打开工具列表 + 最近使用顺序。
 *
 * 注意：应用自带页面（设置）**不进这个列表**——它是左轨底部的固定入口，
 * 由路由直接驱动，既不需要关闭，也不该占「运行中」的名额。
 * store 名与 localStorage key 仍沿用 toolTabs：键里存的是用户历史上打开过的工具 id，
 * 改名只会换来一次无意义的迁移。
 */
export const useToolTabsStore = defineStore('toolTabs', () => {
  // 隐私模式 / 配额满：持久化失败不影响当前会话的打开状态
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
  /** 最近访问过的工具 id（栈顶最新）。内存态：重启后只关心「打开了哪些」，不关心访问顺序 */
  const recentIds = ref<string[]>([])
  /**
   * 每个工具最后停留的完整路由（含子路由）。
   * 工具页常驻后，切换回来必须回到原来的页签，而不是永远落到第一个子路由。
   * 只存在内存里：重启后的页面状态本来就不保留。
   */
  const lastRouteById = ref<Record<string, string>>({})

  const openTools = computed<OpenTool[]>(() =>
    openIds.value
      .map(resolveTool)
      .filter((tool): tool is OpenTool => tool !== null),
  )

  function touchRecent(toolId: string) {
    recentIds.value = [toolId, ...recentIds.value.filter(id => id !== toolId)].slice(0, RECENT_LIMIT)
  }

  function close(toolId: string) {
    const idx = openIds.value.indexOf(toolId)
    if (idx === -1) return
    openIds.value.splice(idx, 1)
    recentIds.value = recentIds.value.filter(id => id !== toolId)
    if (lastRouteById.value[toolId] !== undefined) {
      const next = { ...lastRouteById.value }
      delete next[toolId]
      lastRouteById.value = next
    }
    if (activeId.value === toolId) activeId.value = null
  }

  function rememberRoute(toolId: string, fullPath: string) {
    if (!fullPath.startsWith('/tools/')) return
    if (lastRouteById.value[toolId] === fullPath) return
    lastRouteById.value = { ...lastRouteById.value, [toolId]: fullPath }
  }

  function lastRoute(toolId: string): string | null {
    return lastRouteById.value[toolId] ?? null
  }

  /**
   * 关闭当前工具后的落点：最近使用过、且此刻仍打开着的另一个工具。
   * 必须**在 close 之前**调用（close 会把该工具从 recentIds / openIds 里摘掉）。
   */
  function recentFallback(excludeId: string): string | null {
    return recentIds.value.find(id => id !== excludeId && openIds.value.includes(id)) ?? null
  }

  function syncFromRoute(toolId: string | null) {
    // activeId 镜像当前路由：回到主页（toolId 为空）即清空，保证 rail 高亮永不残留
    if (!toolId) {
      activeId.value = null
      return
    }
    // 应用自带页面（设置）不是工具：不写 openIds，也不参与最近使用
    if (!resolveTool(toolId)) {
      activeId.value = null
      return
    }
    if (!openIds.value.includes(toolId)) openIds.value.push(toolId)
    activeId.value = toolId
    touchRecent(toolId)
  }

  // 上次会话残留的 id（工具被移除 / 历史上存过 settings 这类应用页）在此清理：
  // 只有能解析出元数据的工具才有资格留在列表里，否则 rail 会出现点不动的空图标。
  const validIds = openIds.value.filter(id => resolveTool(id) !== null)
  if (validIds.length !== openIds.value.length) openIds.value = validIds

  // 最近使用顺序用「打开顺序」播种（后打开的更新）：只靠本次会话的访问记录时，
  // 重启后打开着多个工具却从未点过任何一个，关闭当前工具就只能回首页——那不是用户想要的。
  recentIds.value = [...openIds.value].reverse()

  return {
    openIds,
    activeId,
    openTools,
    close,
    recentFallback,
    rememberRoute,
    lastRoute,
    syncFromRoute,
  }
})
