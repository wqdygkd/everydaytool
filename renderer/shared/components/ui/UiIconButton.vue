<script setup lang="ts">
import type { IconName } from './icons'

withDefaults(defineProps<{
  icon: IconName
  /** 按钮边长（默认与控件同高，图标尺寸约为其一半） */
  size?: number
  /** 高亮态（如固定图钉的警示色） */
  active?: boolean
  /** 禁用态（颜色降对比，不加透明度） */
  disabled?: boolean
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
  <button
    type="button"
    class="ui-icon-button"
    :class="[`is-${tone}`, { 'is-active': active }]"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :disabled="disabled"
    :aria-label="label"
    :title="label"
    @click="emit('click', $event)"
  >
    <UiIcon :name="icon" :size="Math.round(size * 0.5)" />
  </button>
</template>

<style scoped lang="scss">
/* 图标按钮：定宽无内边距；hover 用 fill，active 只表达真实选中。 */
.ui-icon-button {
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast);

  flex-shrink: 0;
  color: var(--color-text-secondary);

  &:hover {
    color: var(--color-text-primary);
    background: var(--color-fill);
  }

  &.is-active {
    color: var(--color-primary-strong);
    background: var(--color-primary-soft);
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
