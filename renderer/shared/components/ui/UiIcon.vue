<script setup lang="ts">
import type { IconName } from './icons'
import { icons } from './icons'

withDefaults(defineProps<{
  name: IconName
  size?: number
  strokeWidth?: number
}>(), {
  size: 16,
})

function def(name: IconName) {
  return icons[name]
}
</script>

<template>
  <svg
    class="ui-icon"
    :width="size"
    :height="size"
    :viewBox="`0 0 ${def(name).vb} ${def(name).vb}`"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth ?? def(name).sw ?? 1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <circle
      v-for="(c, i) in def(name).circles ?? []"
      :key="`c${i}`"
      :cx="c[0]"
      :cy="c[1]"
      :r="c[2]"
      :fill="c[3] ? 'currentColor' : 'none'"
      :stroke="c[3] ? 'none' : 'currentColor'"
    />
    <rect
      v-for="(r, i) in def(name).rects ?? []"
      :key="`r${i}`"
      :x="r[0]"
      :y="r[1]"
      :width="r[2]"
      :height="r[3]"
      :rx="r[4] ?? 0"
    />
    <path v-for="(d, i) in def(name).paths ?? []" :key="`p${i}`" :d="d" />
  </svg>
</template>
