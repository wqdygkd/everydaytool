<script setup lang="ts">
import type { IconName } from './icons'

withDefaults(defineProps<{
  icon: IconName
  /** 按钮边长（默认与控件同高，图标尺寸约为其一半） */
  size?: number
  /** 高亮态（如固定图钉的警示色） */
  active?: boolean
  /** 无障碍标签与悬停提示 */
  label?: string
  /** neutral = 弱化描边 + hover 抬深；danger = 弱化灰 + hover 转危险色 */
  tone?: 'neutral' | 'danger'
}>(), {
  size: 32,
  tone: 'neutral',
})

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<template>
  <el-button
    text
    class="ui-icon-button"
    :class="[`is-${tone}`, { 'is-active': active }]"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :aria-label="label"
    :title="label"
    @click="emit('click', $event)"
  >
    <UiIcon :name="icon" :size="Math.round(size * 0.5)" />
  </el-button>
</template>

<style scoped lang="scss">
/* 图标按钮：定宽无内边距，弱化描边；hover 抬深 + 浅底，active 高亮为警示色 */
.ui-icon-button {
  flex-shrink: 0;
  padding: 0;
  color: var(--color-text-secondary);

  &:hover {
    color: var(--color-text-primary);
    background: var(--color-border-light);
  }

  &.is-active {
    color: var(--color-warning);
  }

  &.is-danger {
    color: var(--color-text-tertiary);

    &:hover {
      color: var(--color-error);
      background: transparent;
    }
  }
}
</style>
