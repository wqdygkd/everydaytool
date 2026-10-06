import type { ToolCategoryGroup, ToolClientTarget, ToolDefinition } from '../shared/types/tool'
import chromeSandbox from '@tools/chrome-sandbox/index'
import envBrowser from '@tools/env-browser/index'
import idCardGenerator from '@tools/id-card-generator/index'
import treeaseEditor from '@tools/treease-editor/index'
import wxpEnhancer from '@tools/wxp-enhancer/index'

export const allToolRegistry: ToolDefinition[] = [chromeSandbox, envBrowser, treeaseEditor, wxpEnhancer, idCardGenerator]

function getCurrentToolClientTarget(): ToolClientTarget {
  // 兼容预加载时序：优先读 window.edtRuntime，兜底 UA 判断
  const w = window as unknown as { edtRuntime?: { target?: ToolClientTarget } }
  if (w.edtRuntime?.target) return w.edtRuntime.target
  if (navigator.userAgent.includes('Electron')) {
    // Electron 环境但 edtRuntime 尚未注入时，按平台推断
    return navigator.userAgent.includes('Mac') ? 'mac' : 'win'
  }
  return 'web'
}

function filterToolsForCurrentTarget(tools: ToolDefinition[]): ToolDefinition[] {
  const target = getCurrentToolClientTarget()
  return tools.filter(tool => !tool.disabled && tool.supportedTargets.includes(target))
}

// 动态 getter：避免在模块加载时固化 target，导致 Electron 中误判为 web
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
