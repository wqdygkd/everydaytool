<script setup lang="ts">
import type { IconName } from './icons'

withDefaults(defineProps<{
  name: IconName
  size?: 'sm' | 'md' | 'lg'
  iconSize?: number
  outlined?: boolean
}>(), {
  size: 'md',
  iconSize: 18,
  outlined: false,
})
</script>

<template>
  <span
    class="ui-icon-tile"
    :class="[`is-${size}`, { 'is-outlined': outlined }]"
    aria-hidden="true"
  >
    <UiIcon :name="name" :size="iconSize" />
  </span>
</template>

<style scoped lang="scss">
.ui-icon-tile {
  display: grid;
  place-items: center;
  flex: none;
  border: 1px solid transparent;
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  color: var(--color-primary-strong);

  &.is-sm {
    width: 31px;
    height: 31px;
    border-radius: var(--radius-sm);
  }

  &.is-md {
    width: 38px;
    height: 38px;
    border-radius: var(--radius-control);
  }

  &.is-lg {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-control);
  }

  &.is-outlined {
    border-color: color-mix(in srgb, var(--color-primary) 14%, transparent);
  }
}
</style>
