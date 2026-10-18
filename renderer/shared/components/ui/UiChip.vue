<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
  mono?: boolean
}>(), {
  tone: 'neutral',
})
</script>

<template>
  <span class="ui-chip" :class="[`is-${tone}`, { 'is-mono': mono }]">
    <slot />
  </span>
</template>

<style scoped lang="scss">
.ui-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px var(--spacing-sm);
  border: 1px solid var(--color-border-light);
  border-radius: 999px;
  background: var(--color-surface-raised);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  line-height: 1.5;
  white-space: nowrap;

  &.is-mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  &.is-primary {
    border-color: color-mix(in srgb, var(--color-primary) 35%, transparent);
    background: var(--color-primary-soft);
    color: var(--color-primary);
  }

  /* Telegram 未读徽章式草绿胶囊（实底白字） */
  &.is-success {
    padding: 1px var(--spacing-sm);
    border-color: transparent;
    background: var(--color-success);
    color: var(--color-surface);
    font-weight: var(--font-weight-medium);
  }

  &.is-warning {
    border-color: color-mix(in srgb, var(--color-warning) 35%, transparent);
    background: color-mix(in srgb, var(--color-warning) 10%, transparent);
    color: color-mix(in srgb, var(--color-warning) 80%, #000);
  }

  &.is-danger {
    border-color: color-mix(in srgb, var(--color-error) 35%, transparent);
    background: color-mix(in srgb, var(--color-error) 10%, transparent);
    color: color-mix(in srgb, var(--color-error) 85%, #000);
  }

  &.is-info {
    border-color: color-mix(in srgb, var(--color-primary) 35%, transparent);
    background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-primary);
  }
}
</style>
