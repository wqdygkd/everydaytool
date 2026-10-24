import type { AsyncComponentLoader } from 'vue'
import type { ToolDefinition, ToolDefinitionInput, ToolRouteComponentInput } from '../types/tool'
import { defineAsyncComponent } from 'vue'

const DEFAULT_NEW_TOOL_WINDOW_DAYS = 14

type ToolDefinitionInputWithWindow = ToolDefinitionInput & {
  newToolWindowDays?: number
}

function isRecentlyCreated(createdAt: string | undefined, windowDays: number): boolean {
  if (!createdAt) return false

  const createdTime = new Date(createdAt).getTime()
  if (Number.isNaN(createdTime)) return false

  const ageMs = Date.now() - createdTime
  return ageMs >= 0 && ageMs <= windowDays * 24 * 60 * 60 * 1000
}

function toAsyncComponent(input: ToolRouteComponentInput): Component {
  if (typeof input === 'function') {
    return defineAsyncComponent(input as AsyncComponentLoader)
  }
  // 已是异步组件包装结果时沿用，避免重复包装
  if (typeof input === 'object' && input !== null && '__asyncLoader' in input) {
    return input as Component
  }
  return defineAsyncComponent(() => Promise.resolve(input as Component))
}

export function defineTool({ newToolWindowDays = DEFAULT_NEW_TOOL_WINDOW_DAYS, ...tool }: ToolDefinitionInputWithWindow): ToolDefinition {
  return {
    ...tool,
    route: {
      ...tool.route,
      // 工具页统一按需加载：主包只留首页与应用壳，工具页进入时再拉对应 chunk
      component: toAsyncComponent(tool.route.component),
    },
    isNew: isRecentlyCreated(tool.createdAt, newToolWindowDays),
  }
}
