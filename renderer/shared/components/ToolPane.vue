<script setup lang="ts">
import { provide, ref, toRef } from 'vue'
import { TOOL_OVERLAY_TARGET, TOOL_PANE_ACTIVE, TOOL_PANE_PATH } from './ui/overlay-target'

const props = defineProps<{
  active: boolean
  /** 该工具最后停留的完整路由（隐藏时用于冻结路由驱动的子页签） */
  path: string
}>()

const overlayTarget = ref<HTMLElement | null>(null)

provide(TOOL_OVERLAY_TARGET, overlayTarget)
provide(TOOL_PANE_ACTIVE, toRef(props, 'active'))
provide(TOOL_PANE_PATH, toRef(props, 'path'))
</script>

<template>
  <div
    class="tool-pane"
    :class="{ 'is-active': props.active }"
    :aria-hidden="props.active ? undefined : 'true'"
    :inert="props.active ? undefined : true"
  >
    <slot />
    <!-- 工具内的 Dialog / Popover / Dropdown / Select / Tooltip 统一挂到这里，
         面板隐藏时随面板一起不可见，也不会在切换工具后残留成 body 上的浮层。 -->
    <div ref="overlayTarget" class="tool-overlay-host" />
  </div>
</template>

<style scoped lang="scss">
/* 常驻面板：切换只改变可见性，DOM / 滚动位置 / webview guest 都保持原样。
   visibility 而不是 display:none，避免隐藏时丢掉内部滚动容器的位置。 */
.tool-pane {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity var(--duration-base) var(--ease-out),
    visibility 0s linear var(--duration-base);
}

.tool-pane.is-active {
  visibility: visible;
  opacity: 1;
  pointer-events: auto;
  transition:
    opacity var(--duration-base) var(--ease-out),
    visibility 0s linear 0s;
}

.tool-overlay-host {
  display: contents;
}

@media (prefers-reduced-motion: reduce) {
  .tool-pane,
  .tool-pane.is-active {
    transition-duration: 0.01ms;
  }
}
</style>
