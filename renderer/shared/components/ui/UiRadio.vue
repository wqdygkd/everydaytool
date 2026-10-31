<script setup lang="ts">
import { computed, inject } from 'vue'

const props = defineProps<{
  value: string | number
  disabled?: boolean
}>()

const group = inject<{ value: () => string | number, select: (v: string | number) => void } | null>('uiRadioGroup', null)

const checked = computed(() => group?.value() === props.value)
</script>

<template>
  <label class="ui-radio" :class="{ 'is-checked': checked }">
    <input
      type="radio"
      class="ui-radio-input"
      :checked="checked"
      :disabled="disabled"
      @change="group?.select(value)"
    >
    <span class="ui-radio-dot" aria-hidden="true" />
    <span class="ui-radio-text"><slot /></span>
  </label>
</template>

<style scoped lang="scss">
.ui-radio {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  cursor: pointer;
  user-select: none;
}

.ui-radio-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.ui-radio-dot {
  position: relative;
  width: 14px;
  height: 14px;
  flex: none;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  background: var(--color-field);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.ui-radio-input:focus-visible + .ui-radio-dot {
  box-shadow: 0 0 0 2px var(--color-primary-soft);
  border-color: var(--color-primary);
}

.is-checked .ui-radio-dot {
  border-color: var(--color-primary);

  &::after {
    content: "";
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: var(--color-primary);
  }
}
</style>
