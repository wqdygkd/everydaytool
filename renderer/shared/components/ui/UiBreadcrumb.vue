<script setup lang="ts">
defineProps<{
  items: { label: string }[]
}>()

const emit = defineEmits<{
  navigate: [index: number]
}>()
</script>

<template>
  <nav class="ui-breadcrumb" aria-label="面包屑">
    <template v-for="(item, i) in items" :key="i">
      <UiIcon v-if="i > 0" name="chevronRight" :size="12" class="ui-breadcrumb-sep" />
      <button
        type="button"
        class="ui-breadcrumb-item"
        :class="{ 'is-current': i === items.length - 1 }"
        @click="emit('navigate', i)"
      >
        {{ item.label }}
      </button>
    </template>
  </nav>
</template>

<style scoped lang="scss">
.ui-breadcrumb {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  min-width: 0;
  font-size: var(--font-size-sm);
}

.ui-breadcrumb-sep {
  color: var(--color-text-tertiary);
  flex-shrink: 0;
}

.ui-breadcrumb-item {
  padding: 0;
  border: none;
  background: none;
  color: var(--color-text-secondary);
  font-size: inherit;
  cursor: pointer;
  border-radius: var(--radius-xs);

  &:hover {
    color: var(--color-primary-strong);
  }

  &.is-current {
    color: var(--color-text-primary);
    font-weight: var(--font-weight-medium);
    cursor: default;
  }
}
</style>
