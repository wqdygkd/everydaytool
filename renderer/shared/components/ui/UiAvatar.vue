<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  /** 头像文字（取首字符） */
  text: string
  /** 主题色（渐变底色） */
  color: string
  size?: number
}>(), {
  size: 42,
})

const initial = computed(() => (props.text ?? '').trim().charAt(0).toUpperCase())
const fontSize = computed(() => Math.round(props.size * 0.43))
</script>

<template>
  <span
    class="ui-avatar"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${fontSize}px`,
      background: `linear-gradient(180deg, color-mix(in srgb, ${color} 75%, #fff) 0%, ${color} 100%)`,
    }"
    aria-hidden="true"
  >{{ initial }}</span>
</template>

<style scoped lang="scss">
.ui-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 999px;
  color: var(--color-surface);
  font-family: "Nunito", "Roboto", sans-serif;
  font-weight: 800;
  line-height: 1;
  user-select: none;
}
</style>
