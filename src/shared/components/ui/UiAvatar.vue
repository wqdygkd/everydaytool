<script setup lang="ts">
import type { IconName } from './icons'
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  /** 头像文字（取首字符）；提供 icon 时忽略 */
  text: string
  /** 主题色（渐变底色） */
  color: string
  size?: number
  /** 工具 logo 图标（提供后替代首字符） */
  icon?: IconName
}>(), {
  size: 42,
})

const initial = computed(() => (props.text ?? '').trim().charAt(0).toUpperCase())
const fontSize = computed(() => Math.round(props.size * 0.43))
const iconSize = computed(() => Math.round(props.size * 0.5))
</script>

<template>
  <span
    class="ui-avatar"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${fontSize}px`,
      background: `linear-gradient(180deg, color-mix(in srgb, ${color} 75%, var(--color-on-solid)) 0%, ${color} 100%)`,
    }"
    aria-hidden="true"
  >
    <UiIcon v-if="icon" :name="icon" :size="iconSize" />
    <template v-else>{{ initial }}</template>
  </span>
</template>

<style scoped lang="scss">
.ui-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 999px;
  color: var(--color-on-solid);
  font-family: var(--font-brand);
  font-weight: var(--font-weight-brand);
  line-height: 1;
  user-select: none;
}
</style>
