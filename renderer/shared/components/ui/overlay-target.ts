import type { InjectionKey, Ref } from 'vue'
import { computed, inject, ref } from 'vue'

/** 工具面板的浮层挂载点：由 ToolPane 提供，未提供时退回 body */
export const TOOL_OVERLAY_TARGET: InjectionKey<Ref<HTMLElement | null>> = Symbol('edt.tool-overlay-target')

/** 工具面板当前是否可见：隐藏时浮层组件据此主动关闭 */
export const TOOL_PANE_ACTIVE: InjectionKey<Readonly<Ref<boolean>>> = Symbol('edt.tool-pane-active')

/** 工具面板最后停留的路径：隐藏时用它冻结路由驱动的子页签状态 */
export const TOOL_PANE_PATH: InjectionKey<Readonly<Ref<string>>> = Symbol('edt.tool-pane-path')

const ALWAYS_ACTIVE = ref(true)

export function useToolOverlayTarget(): Readonly<Ref<HTMLElement | string>> {
  const target = inject(TOOL_OVERLAY_TARGET, null)
  return computed(() => target?.value ?? 'body')
}

export function useToolPaneActive(): Readonly<Ref<boolean>> {
  return inject(TOOL_PANE_ACTIVE, ALWAYS_ACTIVE)
}

export function useToolPanePath(): Readonly<Ref<string>> | null {
  return inject(TOOL_PANE_PATH, null)
}
