<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  labelWidth?: string
  mono?: boolean
  /** 窄容器下折行排布 */
  wrap?: boolean
  muted?: boolean
}>(), {
  labelWidth: '64px',
})
</script>

<template>
  <div class="ui-kv" :class="{ 'is-break': wrap, 'is-muted': muted }">
    <span class="ui-kv-label" :style="{ width: labelWidth }">
      {{ label }}
    </span>
    <span class="ui-kv-value" :class="{ 'is-mono': mono }">
      <slot />
    </span>
    <span v-if="$slots.actions" class="ui-kv-actions">
      <slot name="actions" />
    </span>
  </div>
</template>

<style scoped lang="scss">
.ui-kv {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--color-border-light);
  font-size: var(--font-size-sm);

  &.is-break {
    flex-wrap: wrap;
  }

  &.is-muted {
    border-top: none;
    padding-top: 0;
  }
}

.ui-kv-label {
  flex-shrink: 0;
  color: var(--color-text-tertiary);
}

.ui-kv-value {
  color: var(--color-text-primary);
  min-width: 0;
  text-align: right;

  &.is-mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
}

.ui-kv-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-shrink: 0;
}
</style>
