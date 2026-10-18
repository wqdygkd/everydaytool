<script setup lang="ts">
withDefaults(defineProps<{
  /** 底部细分隔线 */
  bordered?: boolean
  /** surface 背景（默认透明，嵌入面板内使用） */
  surface?: boolean
  wrap?: boolean
  gap?: 'xs' | 'sm' | 'md' | 'lg'
  padding?: string
  /** 去掉 Element Plus 按钮间原生 12px 左边距，仅保留 gap（间距以 gap 为准的场景） */
  flush?: boolean
}>(), {
  bordered: false,
  surface: false,
  wrap: false,
  gap: 'sm',
  padding: '0',
  flush: false,
})
</script>

<template>
  <div
    class="ui-toolbar"
    :class="[
      `is-gap-${gap}`,
      { 'is-bordered': bordered, 'is-surface': surface, 'is-wrap': wrap, 'btn-flush': flush },
    ]"
    :style="padding ? { padding } : undefined"
  >
    <div class="ui-toolbar-start">
      <slot />
    </div>
    <div v-if="$slots.end" class="ui-toolbar-end">
      <slot name="end" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.ui-toolbar {
  display: flex;
  align-items: center;
  min-width: 0;

  &.is-wrap {
    flex-wrap: wrap;
  }

  &.is-gap-xs {
    gap: var(--spacing-xs);
  }

  &.is-gap-sm {
    gap: var(--spacing-sm);
  }

  &.is-gap-md {
    gap: var(--spacing-md);
  }

  &.is-gap-lg {
    gap: var(--spacing-lg);
  }

  &.is-bordered {
    border-bottom: 1px solid var(--color-border-light);
  }

  &.is-surface {
    background: var(--color-surface-raised);
  }
}

.ui-toolbar-start {
  display: flex;
  align-items: center;
  gap: inherit;
  flex: 1;
  min-width: 0;
  flex-wrap: inherit;
}

.ui-toolbar-end {
  display: flex;
  align-items: center;
  gap: inherit;
  flex-shrink: 0;
  margin-left: auto;
  flex-wrap: inherit;
}
</style>
