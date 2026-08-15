import type { ToolCategoryGroup, ToolClientTarget, ToolDefinition } from '../shared/types/tool'
import cdpInjector from '@tools/cdp-injector/index'
import chromeSandbox from '@tools/chrome-sandbox/index'
import idCardGenerator from '@tools/id-card-generator/index'

export const allToolRegistry: ToolDefinition[] = [chromeSandbox, cdpInjector, idCardGenerator]
export const toolRegistry: ToolDefinition[] = filterToolsForCurrentTarget(allToolRegistry)
export const toolsByCategory: ToolCategoryGroup[] = groupToolsByCategory(toolRegistry)

export function getToolById(id: string): ToolDefinition | undefined {
  return toolRegistry.find(tool => tool.id === id)
}

export function getActiveTools(): ToolDefinition[] {
  return toolRegistry.filter(tool => !tool.disabled)
}

function getCurrentToolClientTarget(): ToolClientTarget {
  return window.edtRuntime?.target ?? 'web'
}

function filterToolsForCurrentTarget(tools: ToolDefinition[]): ToolDefinition[] {
  const target = getCurrentToolClientTarget()
  return tools.filter(tool => !tool.disabled && tool.supportedTargets.includes(target))
}

export function groupToolsByCategory(tools: ToolDefinition[]): ToolCategoryGroup[] {
  const groups = new Map<string, ToolCategoryGroup>()

  for (const tool of tools) {
    const group = groups.get(tool.category.key)
    if (group) {
      group.tools.push(tool)
      continue
    }

    groups.set(tool.category.key, {
      category: tool.category,
      tools: [tool],
    })
  }

  return Array.from(groups.values())
}
