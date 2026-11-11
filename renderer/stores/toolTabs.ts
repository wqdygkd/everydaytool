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

interface StoredToolTabs {
  openIds: string[]
  openedAt: Record<string, number>
}

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

function sanitizeOpenedAt(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {}
  const openedAt: Record<string, number> = {}
  for (const [id, timestamp] of Object.entries(value)) {
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) openedAt[id] = timestamp
  }
  return openedAt
}

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
  const storedTabs = useLocalStorage<StoredToolTabs>(STORAGE_KEY, { openIds: [], openedAt: {} }, {
    serializer: {
      read(raw) {
        try {
          const value = JSON.parse(raw) as unknown
          // 旧版本存的是 string[]：读到数组就按数组迁移，时间戳由下面的播种补齐。
          if (Array.isArray(value)) return { openIds: sanitizeIds(value), openedAt: {} }
          if (value && typeof value === 'object') {
            const record = value as Partial<StoredToolTabs>
            return {
              openIds: sanitizeIds(record.openIds),
              openedAt: sanitizeOpenedAt(record.openedAt),
            }
          }
        } catch {
          // 损坏的存储按空处理，下一次写入会覆盖。
        }
        return { openIds: [], openedAt: {} }
      },
      write: value => JSON.stringify(value),
    },
    writeDefaults: false,
    onError: () => {},
  })
  const openIds = computed<string[]>({
    get: () => storedTabs.value.openIds,
    set: (ids) => {
      storedTabs.value.openIds = ids
    },
  })
  const openedAtById = computed<Record<string, number>>(() => storedTabs.value.openedAt)
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

  /** 正在运行 = 本次会话打开着的工具，按最近活跃排序 */
  const runningTools = computed<OpenTool[]>(() =>
    [...openTools.value].sort(
      (a, b) => (openedAtById.value[b.id] ?? 0) - (openedAtById.value[a.id] ?? 0),
    ),
  )
  /** 首页右侧只展示最近 3 个 */
  const recentTools = computed<OpenTool[]>(() => runningTools.value.slice(0, 3))

  function markOpened(toolId: string) {
    storedTabs.value.openedAt[toolId] = Date.now()
  }

  function touchRecent(toolId: string) {
    recentIds.value = [toolId, ...recentIds.value.filter(id => id !== toolId)].slice(0, RECENT_LIMIT)
  }

  function close(toolId: string) {
    const idx = openIds.value.indexOf(toolId)
    if (idx === -1) return
    openIds.value.splice(idx, 1)
    recentIds.value = recentIds.value.filter(id => id !== toolId)
    if (storedTabs.value.openedAt[toolId] !== undefined) {
      const next = { ...storedTabs.value.openedAt }
      delete next[toolId]
      storedTabs.value.openedAt = next
    }
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
    markOpened(toolId)
  }

  // 上次会话残留的 id（工具被移除 / 历史上存过 settings 这类应用页）在此清理：
  // 只有能解析出元数据的工具才有资格留在列表里，否则 rail 会出现点不动的空图标。
  const validIds = openIds.value.filter(id => resolveTool(id) !== null)
  if (validIds.length !== openIds.value.length) openIds.value = validIds

  // 旧数据没有时间戳：按打开顺序不早于现在倒推几秒播种，保留原来的「后打开更新」语义。
  const seededAt = Date.now()
  openIds.value.forEach((id, index) => {
    if (typeof storedTabs.value.openedAt[id] !== 'number') {
      storedTabs.value.openedAt[id] = seededAt - (openIds.value.length - index) * 1000
    }
  })

  // 最近使用顺序用「打开顺序」播种（后打开的更新）：只靠本次会话的访问记录时，
  // 重启后打开着多个工具却从未点过任何一个，关闭当前工具就只能回首页——那不是用户想要的。
  recentIds.value = [...openIds.value].reverse()

  return {
    openIds,
    openedAtById,
    activeId,
    openTools,
    runningTools,
    recentTools,
    close,
    recentFallback,
    rememberRoute,
    lastRoute,
    syncFromRoute,
  }
})
