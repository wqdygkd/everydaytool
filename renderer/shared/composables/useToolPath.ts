import type { ComputedRef } from 'vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useToolPaneActive, useToolPanePath } from '../components/ui/overlay-target'

/**
 * 工具页里的“当前路径”。
 *
 * 工具页常驻后，隐藏面板的 `useRoute()` 仍会跟着全局路由变化；如果子页签直接读
 * `route.path`，切到别的工具时会被重置成第一个页签，甚至卸载当前子视图。
 * 这里在面板隐藏时冻结到最后一次停留的路径，切回来再恢复全局路径。
 */
export function useToolPath(): ComputedRef<string> {
  const route = useRoute()
  const paneActive = useToolPaneActive()
  const panePath = useToolPanePath()

  return computed(() => {
    if (paneActive.value) return route.path
    const frozen = panePath?.value ?? ''
    return frozen ? frozen.split(/[?#]/, 1)[0] : route.path
  })
}
