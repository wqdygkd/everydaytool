<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <aside class="tool-form-pane" :aria-label="title">
    <header class="tool-form-pane-head">
      <span class="tool-form-pane-title">{{ title }}</span>
      <div v-if="$slots.actions" class="tool-form-pane-actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="tool-form-pane-body">
      <slot />
    </div>
  </aside>
</template>

<style scoped lang="scss">
.tool-form-pane {
  display: flex;
  flex: 0 0 360px;
  flex-direction: column;
  width: 360px;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--color-border-light);
}

.tool-form-pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  flex: 0 0 48px;
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--color-border-light);
}

.tool-form-pane-title {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.tool-form-pane-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.tool-form-pane-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 16px;
  overflow-y: auto;
}

@media (max-width: 1180px) {
  .tool-form-pane {
    flex-basis: 320px;
    width: 320px;
  }
}
</style>
