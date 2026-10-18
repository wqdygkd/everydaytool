<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  /** 呼吸光环动画 */
  pulsing?: boolean
}>(), {
  tone: 'neutral',
})
</script>

<template>
  <span
    class="ui-status-dot"
    :class="[`is-${tone}`, { 'is-pulsing': pulsing }]"
    aria-hidden="true"
  />
</template>

<style scoped lang="scss">
.ui-status-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  border-radius: var(--radius-xs);
  background: var(--color-text-tertiary);

  &.is-success {
    background: var(--color-success);
  }

  &.is-warning {
    background: var(--color-warning);
  }

  &.is-danger {
    background: var(--color-error);
  }

  &.is-pulsing {
    animation: ui-status-pulse 2s ease-in-out infinite;
  }
}

@keyframes ui-status-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-success) 45%, transparent);
  }

  50% {
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--color-success) 0%, transparent);
  }
}
</style>
