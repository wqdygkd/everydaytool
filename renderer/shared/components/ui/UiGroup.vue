<script setup lang="ts">
withDefaults(defineProps<{
  wrap?: boolean
  gap?: 'xs' | 'sm' | 'md' | 'lg'
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline'
  justify?: 'start' | 'end' | 'between' | 'center'
  block?: boolean
  direction?: 'row' | 'column'
}>(), {
  gap: 'sm',
  align: 'center',
  justify: 'start',
  direction: 'row',
})
</script>

<template>
  <div
    class="ui-group"
    :class="[
      `is-gap-${gap}`,
      `is-align-${align}`,
      `is-justify-${justify}`,
      { 'is-wrap': wrap, 'is-block': block, 'is-column': direction === 'column' },
    ]"
  >
    <slot />
  </div>
</template>

<style scoped lang="scss">
.ui-group {
  display: flex;
  min-width: 0;

  &.is-block {
    width: 100%;
  }

  &.is-column {
    flex-direction: column;
  }

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

  &.is-align-start {
    align-items: flex-start;
  }

  &.is-align-center {
    align-items: center;
  }

  &.is-align-end {
    align-items: flex-end;
  }

  &.is-align-stretch {
    align-items: stretch;
  }

  &.is-align-baseline {
    align-items: baseline;
  }

  &.is-justify-start {
    justify-content: flex-start;
  }

  &.is-justify-end {
    justify-content: flex-end;
  }

  &.is-justify-between {
    justify-content: space-between;
  }

  &.is-justify-center {
    justify-content: center;
  }
}
</style>
