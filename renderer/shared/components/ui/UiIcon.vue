<script setup lang="ts">
import type { IconDef, IconName } from './icons'
import { computed } from 'vue'
import { icons } from './icons'

const props = withDefaults(defineProps<{
  name: IconName
  size?: number
  strokeWidth?: number
}>(), {
  size: 16,
})

// 图标名虽被 IconName 类型约束，但可能经上游数据流转（工具定义 / 配置镜像）进入运行时：
// 未知名字降级为不渲染并 warn，绝不让单个图标崩掉整页（曾把首页整页白屏）。
const resolved = computed<IconDef | undefined>(() => {
  const def = icons[props.name]
  if (!def) {
    console.warn(`[UiIcon] 未知图标名: ${String(props.name)}`)
    return undefined
  }
  return def
})
</script>

<template>
  <svg
    v-if="resolved"
    class="ui-icon"
    :width="size"
    :height="size"
    :viewBox="`0 0 ${resolved.vb} ${resolved.vb}`"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth ?? resolved.sw ?? 1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <circle
      v-for="(c, i) in resolved.circles ?? []"
      :key="`c${i}`"
      :cx="c[0]"
      :cy="c[1]"
      :r="c[2]"
      :fill="c[3] ? 'currentColor' : 'none'"
      :stroke="c[3] ? 'none' : 'currentColor'"
    />
    <rect
      v-for="(r, i) in resolved.rects ?? []"
      :key="`r${i}`"
      :x="r[0]"
      :y="r[1]"
      :width="r[2]"
      :height="r[3]"
      :rx="r[4] ?? 0"
    />
    <path v-for="(d, i) in resolved.paths ?? []" :key="`p${i}`" :d="d" />
  </svg>
</template>
