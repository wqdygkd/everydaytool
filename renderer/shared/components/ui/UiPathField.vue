<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  mono?: boolean
}>(), {})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const value = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v),
})
</script>

<template>
  <div class="ui-path-field">
    <!-- 输入内核：EP → 原生 input + 可选前置块（EP prepend 同款灰底） -->
    <div class="ui-path-input" :class="{ 'is-mono': mono, 'has-prepend': !!$slots.prepend }">
      <span v-if="$slots.prepend" class="ui-path-prepend">
        <slot name="prepend" />
      </span>
      <input
        v-model="value"
        :placeholder="placeholder"
        :disabled="disabled"
        spellcheck="false"
      >
    </div>
    <span v-if="$slots.actions" class="ui-path-actions">
      <slot name="actions" />
    </span>
  </div>
</template>

<style scoped lang="scss">
.ui-path-field {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  width: 100%;
  min-width: 0;

  .ui-path-input {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: stretch;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);

    &:focus-within {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 1px var(--color-primary) inset;
    }

    input {
      flex: 1;
      min-width: 0;
      height: var(--control-height);
      padding: 0 11px;
      border: 0;
      outline: none;
      background: transparent;
      color: var(--color-text-primary);
      font-size: var(--font-size-base);

      &::placeholder { color: var(--color-text-tertiary); }

      &:disabled { color: var(--color-text-tertiary); cursor: not-allowed; }
    }

    &.is-mono input {
      font-family: var(--font-mono);
      font-variant-numeric: tabular-nums;
      font-size: var(--font-size-sm);
    }
  }
}

.ui-path-prepend {
  display: flex;
  align-items: center;
  padding: 0 var(--spacing-md);
  border-right: 1px solid var(--color-border);
  border-radius: calc(var(--radius-sm) - 1px) 0 0 calc(var(--radius-sm) - 1px);
  background: var(--color-fill);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  white-space: nowrap;
}

.ui-path-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-shrink: 0;
}
</style>
