import type { ToolCategoryGroup, ToolClientTarget, ToolDefinition } from '../shared/types/tool'
import chromeSandbox from '@tools/chrome-sandbox/index'
import envBrowser from '@tools/env-browser/index'
import idCardGenerator from '@tools/id-card-generator/index'
import interceptor from '@tools/interceptor/index'
import offlinePack from '@tools/offline-pack/index'
import treeaseEditor from '@tools/treease-editor/index'
import workbuddy2apiPanel from '@tools/workbuddy2api-panel/index'
import wxpEnhancer from '@tools/wxp-enhancer/index'
import { getClientTarget } from '../desktop/platform'

export const allToolRegistry: ToolDefinition[] = [interceptor, chromeSandbox, envBrowser, treeaseEditor, wxpEnhancer, idCardGenerator, offlinePack, workbuddy2apiPanel]

function getCurrentToolClientTarget(): ToolClientTarget {
  return getClientTarget()
}

function filterToolsForCurrentTarget(tools: ToolDefinition[]): ToolDefinition[] {
  const target = getCurrentToolClientTarget()
  return tools.filter(tool => !tool.disabled && tool.supportedTargets.includes(target))
}

// 动态 getter：避免在模块加载时固化 target，导致桌面端误判为 web
export function getToolRegistry(): ToolDefinition[] {
  return filterToolsForCurrentTarget(allToolRegistry)
}

export function getToolById(id: string): ToolDefinition | undefined {
  return getToolRegistry().find(tool => tool.id === id)
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
