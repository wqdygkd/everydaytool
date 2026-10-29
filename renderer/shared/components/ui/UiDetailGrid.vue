<script setup lang="ts">
withDefaults(defineProps<{
  columns?: number
}>(), {
  columns: 2,
})
</script>

<template>
  <div
    class="ui-detail-grid"
    :style="{ '--ui-detail-cols': columns }"
  >
    <slot />
  </div>
</template>

<style scoped lang="scss">
.ui-detail-grid {
  display: grid;
  grid-template-columns: repeat(var(--ui-detail-cols, 2), minmax(0, 1fr));
  gap: var(--spacing-lg);
}

@media (max-width: 760px) {
  .ui-detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
