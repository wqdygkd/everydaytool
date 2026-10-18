<script setup lang="ts">
withDefaults(defineProps<{
  /** 块级提示（带上下间距）；默认行内 */
  block?: boolean
  size?: 'xs' | 'sm'
  align?: 'start' | 'center' | 'end'
}>(), {
  size: 'sm',
  align: 'start',
})
</script>

<template>
  <p
    class="ui-hint"
    :class="[
      `is-${size}`,
      `is-align-${align}`,
      { 'is-block': block },
    ]"
  >
    <slot />
  </p>
</template>

<style scoped lang="scss">
.ui-hint {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: 1.4;

  &.is-xs {
    font-size: var(--font-size-xs);
  }

  &.is-sm {
    font-size: var(--font-size-sm);
  }

  &.is-block {
    display: block;
    margin-top: var(--spacing-sm);
  }

  &.is-align-center {
    text-align: center;
  }

  &.is-align-end {
    text-align: right;
  }
}
</style>
