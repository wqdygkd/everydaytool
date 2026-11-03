<script setup lang="ts">
import type { IconName } from '../ui/icons'

withDefaults(defineProps<{
  icon: IconName
  title: string
  description?: string
  statusLabel?: string
  statusTone?: 'neutral' | 'success' | 'warning' | 'danger'
}>(), {
  description: '',
  statusLabel: '',
  statusTone: 'neutral',
})
</script>

<template>
  <header class="workspace-header">
    <UiIconTile :name="icon" size="lg" :icon-size="20" outlined />

    <div class="workspace-copy">
      <div class="workspace-title-line">
        <h1 class="text-truncate">
          {{ title }}
        </h1>
        <span v-if="statusLabel" class="workspace-status" :class="`is-${statusTone}`">
          <UiStatusTag :tone="statusTone" />
          {{ statusLabel }}
        </span>
      </div>
      <p v-if="description" class="text-truncate">
        {{ description }}
      </p>
    </div>

    <div v-if="$slots.actions" class="workspace-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped lang="scss">
.workspace-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 0 0 var(--workspace-header-height);
  height: var(--workspace-header-height);
  min-width: 0;
  padding: 0 18px;
}

.workspace-copy {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 1px;

  p {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
  }
}

.workspace-title-line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;

  h1 {
    margin: 0;
    color: var(--color-text-primary);
    font-size: 17px;
    font-weight: var(--font-weight-medium);
    line-height: 1.25;
  }
}

.workspace-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.workspace-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: none;

  :deep(.ui-button.is-small) {
    height: var(--control-height);
    padding: 0 13px;
  }
}
</style>
