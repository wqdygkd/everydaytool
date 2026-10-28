import type { ToolClientTarget, ToolDefinition } from '../shared/types/tool'
import chromeSandbox from '@tools/chrome-sandbox/index'
import envBrowser from '@tools/env-browser/index'
import idCardGenerator from '@tools/id-card-generator/index'
import interceptor from '@tools/interceptor/index'
import offlinePack from '@tools/offline-pack/index'
import telegramCache from '@tools/telegram-cache/index'
import treeaseEditor from '@tools/treease-editor/index'
import workbuddy2apiPanel from '@tools/workbuddy2api-panel/index'
import wxpEnhancer from '@tools/wxp-enhancer/index'

export const allToolRegistry: ToolDefinition[] = [interceptor, chromeSandbox, envBrowser, treeaseEditor, wxpEnhancer, idCardGenerator, offlinePack, telegramCache, workbuddy2apiPanel]

function getCurrentToolClientTarget(): ToolClientTarget {
  // 兼容预加载时序：优先读 window.edtRuntime，兜底 UA 判断
  const w = window as unknown as { edtRuntime?: { target?: ToolClientTarget } }
  if (w.edtRuntime?.target) return w.edtRuntime.target
  if (navigator.userAgent.includes('Electron')) {
    // Electron 环境但 edtRuntime 尚未注入时，按平台推断
    if (navigator.userAgent.includes('Mac')) return 'mac'
    if (/Linux/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent)) return 'linux'
    return 'win'
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
