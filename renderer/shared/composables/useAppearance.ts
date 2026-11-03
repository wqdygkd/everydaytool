import type { WindowAppearance, WindowAppearanceCapabilities, WindowAppearanceUpdate } from '../../../shared/appearance'
import { createSharedComposable } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { appIpcChannels, invokeAppIpc, onAppIpc } from '../ipc/useAppIpc'

/**
 * 窗口外观（半透明 / 系统材质）的渲染层状态。
 * 单一数据源是主进程（持久化在 userData/window-appearance.json）：本 composable 只做
 * 拉取 + 订阅 + 提交，不在 localStorage 留副本；应用壳与设置页共享同一份状态和订阅。
 */
export interface AppearanceState {
  appearance: WindowAppearance
  capabilities: WindowAppearanceCapabilities
}

export const useAppearance = createSharedComposable(() => {
  const appearance = ref<WindowAppearance | null>(null)
  const capabilities = ref<WindowAppearanceCapabilities | null>(null)
  const loading = ref(false)
  let unsubscribe: (() => void) | undefined
  let loadPromise: Promise<void> | null = null

  function load(): Promise<void> {
    if (loadPromise) return loadPromise
    loading.value = true
    loadPromise = (async () => {
      try {
        const state = await invokeAppIpc<AppearanceState>(appIpcChannels().APPEARANCE_GET)
        appearance.value = state.appearance
        capabilities.value = state.capabilities
      } catch {
        // 纯浏览器调试（无 edtApp 注入）时静默：界面保持不透明默认态
        appearance.value = null
        capabilities.value = null
      } finally {
        loading.value = false
        loadPromise = null
      }
    })()
    return loadPromise
  }

  /** 提交补丁；返回值是主进程按平台裁剪后的最终值（渲染层以它为准） */
  async function update(patch: WindowAppearanceUpdate): Promise<WindowAppearance | null> {
    try {
      const next = await invokeAppIpc<WindowAppearance>(appIpcChannels().APPEARANCE_SET, patch)
      appearance.value = next
      return next
    } catch (error) {
      toast.error((error as Error).message || '切换窗口外观失败')
      return null
    }
  }

  function subscribe() {
    if (unsubscribe) return
    try {
      unsubscribe = onAppIpc<WindowAppearance>(
        appIpcChannels().EVENT_APPEARANCE_CHANGED,
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
})
