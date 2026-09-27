import { defineStore } from 'pinia'
import { getToolRegistry } from '../config/tools'

export interface ToolTab {
  id: string
  name: string
  routeName: string
}

const STORAGE_KEY = 'edt:tool-tabs'

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
}

export const useToolTabsStore = defineStore('toolTabs', () => {
  const openIds = ref<string[]>(readStored())
  const activeId = ref<string | null>(null)

  const openTabs = computed<ToolTab[]>(() =>
    openIds.value
      .map((id) => {
        const tool = getToolRegistry().find(t => t.id === id)
        if (!tool) return null
        return {
          id: tool.id,
          name: tool.name,
          routeName: `tool-${tool.id}`,
        } as ToolTab
      })
      .filter((t): t is ToolTab => Boolean(t)),
  )

  function persist() {
    writeStored(openIds.value)
  }

  function close(toolId: string) {
    const idx = openIds.value.indexOf(toolId)
    if (idx === -1) return
    openIds.value.splice(idx, 1)
    persist()
    if (activeId.value === toolId) {
      const next = openIds.value[idx] || openIds.value[idx - 1] || null
      activeId.value = next
    }
  }

  function syncFromRoute(toolId: string | null) {
    if (!toolId) return
    if (!openIds.value.includes(toolId)) {
      openIds.value.push(toolId)
      persist()
    }
    activeId.value = toolId
  }

  // 清理已不存在的工具
  const validIds = openIds.value.filter(id => getToolRegistry().some(t => t.id === id))
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
  }
})
