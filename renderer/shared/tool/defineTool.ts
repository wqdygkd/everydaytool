import type { ToolDefinition } from '../types/tool'

const DEFAULT_NEW_TOOL_WINDOW_DAYS = 14

type ToolDefinitionInput = Omit<ToolDefinition, 'isNew'> & {
  newToolWindowDays?: number
}

function isRecentlyCreated(createdAt: string | undefined, windowDays: number): boolean {
  if (!createdAt) return false

  const createdTime = new Date(createdAt).getTime()
  if (Number.isNaN(createdTime)) return false

  const ageMs = Date.now() - createdTime
  return ageMs >= 0 && ageMs <= windowDays * 24 * 60 * 60 * 1000
}

export function defineTool({ newToolWindowDays = DEFAULT_NEW_TOOL_WINDOW_DAYS, ...tool }: ToolDefinitionInput): ToolDefinition {
  return {
    ...tool,
    isNew: isRecentlyCreated(tool.createdAt, newToolWindowDays),
  }
}
