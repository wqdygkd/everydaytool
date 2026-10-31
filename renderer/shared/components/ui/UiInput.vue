<script setup lang="ts">
// 通用输入框内核:EP el-input(无前后缀场景)→ 原生 input。
// 带搜索图标 / 清空的场景用 UiSearchInput;路径 + 前置块用 UiPathField。
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  /** small = 24px 高;default = 控件同高 */
  size?: 'small' | 'default'
  inputType?: 'text' | 'url' | 'password' | 'number'
}>(), {
  placeholder: undefined,
  disabled: false,
  size: 'default',
  inputType: 'text',
  modelValue: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const value = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})
</script>

<template>
  <input
    v-model="value"
    :type="inputType"
    class="ui-input"
    :class="`is-${size}`"
    :placeholder="placeholder"
    :disabled="disabled"
  >
</template>

<style scoped lang="scss">
.ui-input {
  display: block;
  min-width: 0;
  padding: 0 11px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-field);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-base);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);

  &.is-small {
    height: 24px;
    font-size: var(--font-size-sm);
  }

  &.is-default {
    height: var(--control-height);
  }

  &::placeholder {
    color: var(--color-text-tertiary);
  }

  &:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 1px var(--color-primary) inset;
  }

  &:disabled {
    background: var(--color-fill);
    color: var(--color-text-tertiary);
    cursor: not-allowed;
  }
}
</style>
