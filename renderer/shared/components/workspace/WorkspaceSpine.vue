<script setup lang="ts">
export interface SpineItem {
  key: string
  label: string
  count?: string | number
}

const props = withDefaults(defineProps<{
  items: SpineItem[]
  modelValue: string
  label?: string
}>(), {
  label: '子视图',
})

const emit = defineEmits<{
  'update:modelValue': [key: string]
}>()
</script>

<template>
  <nav class="spine" role="tablist" :aria-label="props.label">
    <div class="spine-label">
      {{ props.label }}
    </div>
    <button
      v-for="item in props.items"
      :key="item.key"
      type="button"
      role="tab"
      class="spine-tab"
      :class="{ 'is-on': item.key === props.modelValue }"
      :aria-selected="item.key === props.modelValue"
      @click="emit('update:modelValue', item.key)"
    >
      <span class="cap">{{ item.label }}</span>
      <span v-if="item.count !== undefined && item.count !== ''" class="badge">{{ item.count }}</span>
    </button>
    <div class="spine-grow" />
    <span class="spine-grip" aria-hidden="true" />
  </nav>
</template>

<style scoped lang="scss">
.spine {
  display: flex;
  flex: 0 0 var(--spine-width);
  flex-direction: column;
  gap: 3px;
  width: var(--spine-width);
  min-height: 0;
  padding: 10px 8px;
  overflow: hidden;
  border-right: 1px solid var(--color-border-light);
  background: color-mix(in srgb, var(--color-fill) 70%, var(--color-raised));
}

.spine-label {
  padding: 2px 9px 6px;
  color: var(--color-text-tertiary);
  font-size: 10px;
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.06em;
}

.spine-tab {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex: none;
  height: 32px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
  outline: none;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);

  &:hover {
    border-color: var(--color-border-light);
    background: var(--color-input);
    color: var(--color-text-primary);
  }

  &:focus-visible {
    box-shadow: var(--shadow-focus);
  }

  &.is-on {
    border-color: color-mix(in srgb, var(--color-primary) 17%, transparent);
    background: color-mix(in srgb, var(--color-primary) 9%, transparent);
    color: var(--color-text-primary);
    font-weight: var(--font-weight-medium);

    .badge {
      color: var(--color-text-secondary);
    }
  }
}

.cap {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  flex: none;
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.spine-grow {
  flex: 1;
}

.spine-grip {
  flex: none;
  width: 18px;
  height: 3px;
  margin: 8px auto 2px;
  border-radius: 999px;
  background: var(--color-border-light);
}

@media (max-width: 1100px) {
  .spine {
    flex-basis: 86px;
    width: 86px;
  }

  .badge {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spine-tab {
    transition-duration: 0.01ms;
  }
}
</style>
