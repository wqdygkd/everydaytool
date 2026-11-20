<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  description?: string
  divider?: boolean
}>(), {
  description: undefined,
  divider: true,
})
</script>

<template>
  <section class="tool-form-section" :class="{ 'is-divided': divider }">
    <header class="tool-form-section-head">
      <div class="tool-form-section-copy">
        <strong>{{ title }}</strong>
        <span v-if="description">{{ description }}</span>
      </div>
      <div v-if="$slots.actions" class="tool-form-section-actions">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>

<style scoped lang="scss">
.tool-form-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.tool-form-section.is-divided {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border-light);
}

.tool-form-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.tool-form-section-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.tool-form-section-copy strong {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.tool-form-section-copy span {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  line-height: 1.45;
}

.tool-form-section-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-sm);
}
</style>
