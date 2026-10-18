<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  mono?: boolean
  /** 值区域断行展示（长路径等） */
  wrap?: boolean
  size?: 'sm' | 'xs'
}>(), {
  size: 'sm',
})
</script>

<template>
  <div class="ui-detail-item" :class="`is-${size}`">
    <span class="ui-detail-label">{{ label }}</span>
    <div class="ui-detail-value" :class="{ 'is-mono': mono, 'is-break': wrap }">
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
.ui-detail-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-surface-raised);
  font-size: var(--font-size-sm);
  min-width: 0;

  &.is-xs {
    gap: var(--spacing-xs);
    padding: var(--spacing-sm) var(--spacing-md);
    font-size: var(--font-size-xs);
  }
}

.ui-detail-label {
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.ui-detail-value {
  color: var(--color-text-primary);
  min-width: 0;

  &.is-mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  &.is-break {
    word-break: break-all;
  }

  /* 原 .detail-item .path：等宽小字号长路径 */
  :deep(.path) {
    font-size: var(--font-size-xs);
    word-break: break-all;
  }
}
</style>
