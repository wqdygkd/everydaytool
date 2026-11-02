<script setup lang="ts">
// 单选组内核：原生 role=radiogroup + provide/inject。
import { provide } from 'vue'

const props = defineProps<{
  modelValue: string | number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
}>()

provide('uiRadioGroup', {
  value: () => props.modelValue,
  select: (v: string | number) => emit('update:modelValue', v),
})
</script>

<template>
  <div role="radiogroup" class="ui-radio-group">
    <slot />
  </div>
</template>

<style scoped lang="scss">
.ui-radio-group {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  flex-wrap: wrap;
}
</style>
