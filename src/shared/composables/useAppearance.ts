import type { WindowAppearance, WindowAppearanceCapabilities, WindowAppearanceUpdate } from '../../../shared/appearance'
import { appCommands, invokeAppCommand, onAppCommand } from '../commands/useAppCommands'

/**
 * 窗口外观（半透明 / 系统材质）的渲染层状态。
 * 单一数据源是主进程（持久化在数据目录下的 window-appearance.json）：本 composable 只做
 * 拉取 + 订阅 + 提交，不在 localStorage 留副本，避免两处状态漂移。
 */
export interface AppearanceState {
  appearance: WindowAppearance
  capabilities: WindowAppearanceCapabilities
}

export function useAppearance() {
  const appearance = ref<WindowAppearance | null>(null)
  const capabilities = ref<WindowAppearanceCapabilities | null>(null)
  const loading = ref(false)
  let unsubscribe: (() => void) | undefined

  async function load() {
    loading.value = true
    try {
      const state = await invokeAppCommand<AppearanceState>(appCommands().APPEARANCE_GET)
      appearance.value = state.appearance
      capabilities.value = state.capabilities
    } catch {
      // 纯浏览器调试（无 edtApp 注入）时静默：界面保持不透明默认态
      appearance.value = null
      capabilities.value = null
    } finally {
      loading.value = false
    }
  }

  /** 提交补丁；返回值是主进程按平台裁剪后的最终值（渲染层以它为准） */
  async function update(patch: WindowAppearanceUpdate): Promise<WindowAppearance | null> {
    try {
      const next = await invokeAppCommand<WindowAppearance>(appCommands().APPEARANCE_SET, patch)
      appearance.value = next
      return next
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : String(error) || '切换窗口外观失败')
      return null
    }
  }

  function subscribe() {
    if (unsubscribe) return
    try {
      unsubscribe = onAppCommand<WindowAppearance>(
        appCommands().EVENT_APPEARANCE_CHANGED,
        (next: WindowAppearance) => (appearance.value = next),
      )
    } catch {
      // 纯浏览器调试：无事件通道可订阅
    }
  }

  onScopeDispose(() => {
    unsubscribe?.()
    unsubscribe = undefined
  })

  return { appearance, capabilities, loading, load, update, subscribe }
}
