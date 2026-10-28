<script setup lang="ts">
defineProps<{
  title: string
  count?: number | string
}>()
</script>

<template>
  <div class="ui-section-header">
    <h2>
      <!-- #title 让调用方插一个语义记号（如收藏区的琥珀星）；不传时退化为 title 文本 -->
      <slot name="title">
        {{ title }}
      </slot>
    </h2>
    <span v-if="count !== undefined" class="ui-section-count">{{ count }}</span>
    <div v-if="$slots.actions" class="ui-section-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.ui-section-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-md);

  h2 {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin: 0;
    color: var(--color-text-primary);
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-medium);
  }
}

.ui-section-count {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
}

.ui-section-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-left: auto;
}
</style>
