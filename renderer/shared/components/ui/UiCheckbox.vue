<script setup lang="ts">
// 复选框内核：原生 input + 自绘勾选框（支持半选态）。
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  indeterminate?: boolean
  disabled?: boolean
}>(), {
  indeterminate: false,
  disabled: false,
})

const modelValue = defineModel<boolean>({ required: true })

const checked = computed(() => props.indeterminate ? false : modelValue.value)
</script>

<template>
  <label class="ui-checkbox" :class="{ 'is-disabled': disabled }">
    <input
      type="checkbox"
      class="ui-checkbox-input"
      :checked="checked"
      :indeterminate="indeterminate"
      :disabled="disabled"
      @change="modelValue = ($event.target as HTMLInputElement).checked"
    >
    <span class="ui-checkbox-box" aria-hidden="true">{{ indeterminate ? '–' : '✓' }}</span>
    <span v-if="$slots.default" class="ui-checkbox-text"><slot /></span>
  </label>
</template>

<style scoped lang="scss">
.ui-checkbox {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  cursor: pointer;
  user-select: none;
}

.ui-checkbox-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.ui-checkbox-box {
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  flex: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-field);
  color: transparent;
  font-size: 10px;
  line-height: 1;
  transition: border-color var(--transition-fast), background var(--transition-fast);
}

.ui-checkbox-input:checked + .ui-checkbox-box,
.ui-checkbox-input:indeterminate + .ui-checkbox-box {
  border-color: var(--color-primary-strong);
  background: var(--color-primary-strong);
  color: var(--color-on-solid);
}

.ui-checkbox-input:focus-visible + .ui-checkbox-box {
  box-shadow: 0 0 0 2px var(--color-primary-soft);
}

.is-disabled {
  color: var(--color-text-tertiary);
  cursor: not-allowed;

  .ui-checkbox-box {
    background: var(--color-fill);
  }
}
</style>
