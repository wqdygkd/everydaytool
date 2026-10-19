<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  text?: string
  /** bordered = 虚线框；plain = 无边框纯文本 */
  variant?: 'plain' | 'bordered'
  /** 居中排布（图标在上文字在下） */
  center?: boolean
  icon?: string
  padding?: string
}>(), {
  variant: 'plain',
})

// bordered 未显式传 padding 时用默认内边距；plain 默认无内边距
const pad = computed(() => props.padding ?? (props.variant === 'bordered' ? 'var(--spacing-xl) var(--spacing-lg)' : '0'))
</script>

<template>
  <div
    class="ui-empty"
    :class="[`is-${variant}`, { 'is-center': center }]"
    :style="{ padding: pad }"
  >
    <UiIcon v-if="icon" :name="(icon as any)" :size="20" class="ui-empty-icon" />
    <span class="ui-empty-text"><slot>{{ text }}</slot></span>
  </div>
</template>

<style scoped lang="scss">
.ui-empty {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);

  &.is-bordered {
    border: 1px dashed var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-raised);
  }

  &.is-center {
    flex-direction: column;
    justify-content: center;
    text-align: center;
  }

  /* 有图标时图标与文字间保留间距（无图标不引入 gap，避免干扰 slot 自定义排版） */
  &.is-center:has(.ui-empty-icon) {
    gap: var(--spacing-sm);
  }
}

.ui-empty-icon {
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.ui-empty-text {
  min-width: 0;
}
</style>
