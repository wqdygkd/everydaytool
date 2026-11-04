<script setup lang="ts">
// 浮层提示内核：Reka UI Tooltip。
// 为什么必须有这个组件：左轨（AppRail）的运行列表要能滚动（overflow-y:auto），
// 滚动容器会裁掉子元素溢出到列外的伪元素 tooltip；提示层因此必须 portal 到 body。
//
// 为什么样式挂在里面这层 div 上：TooltipContent 的根元素由 Reka 渲染，Vue 不会给它补
// 本组件的 scopeId，写成 `<TooltipContent class="ui-tooltip">` 的 scoped 样式会整条失效
// （提示会变成 16px 透明底的裸文字）。把可样式化的结构放进本模板里的 div 才吃得到 scoped。
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'

withDefaults(defineProps<{
  /** 提示文案（纯文本，不解析 HTML） */
  text: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** 悬停延迟，与旧 rail 提示的 180ms 对齐 */
  delay?: number
}>(), {
  side: 'right',
  delay: 180,
})

/** 定位层（Reka 根元素）只承担定位与层级：不吃指针事件，避免提示框挡住底下内容 */
const layerStyle = { pointerEvents: 'none', zIndex: 2600 } as const
</script>

<template>
  <TooltipProvider :delay-duration="delay">
    <TooltipRoot>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent :side="side" :side-offset="8" :style="layerStyle">
          <div class="ui-tooltip">
            {{ text }}
          </div>
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>

<style scoped lang="scss">
.ui-tooltip {
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, var(--color-on-solid) 12%, transparent);
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, #0e1721 94%, transparent);
  box-shadow: var(--shadow-sm);
  color: #f2f7fc;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  line-height: 1.3;
  white-space: nowrap;
  user-select: none;
  animation: ui-tooltip-in var(--duration-fast) var(--ease-out);
}

@keyframes ui-tooltip-in {
  from {
    opacity: 0;
    transform: translateX(-3px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ui-tooltip {
    animation-duration: 0.01ms;
  }
}
</style>
