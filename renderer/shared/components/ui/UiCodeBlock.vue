<script setup lang="ts">
withDefaults(defineProps<{
  maxHeight?: string
  wrap?: boolean
}>(), {
  maxHeight: '200px',
})
</script>

<template>
  <pre
    class="ui-code-block"
    :class="{ 'is-wrap': wrap }"
    :style="{ maxHeight }"
  ><code><slot /></code></pre>
</template>

<style scoped lang="scss">
.ui-code-block {
  margin: 0;
  padding: var(--spacing-sm);
  overflow: auto;
  border-radius: var(--radius-sm);
  background: var(--color-canvas);
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  line-height: 1.5;

  code {
    font-family: inherit;
  }

  &.is-wrap {
    white-space: pre-wrap;
    word-break: break-all;
  }
}
</style>
