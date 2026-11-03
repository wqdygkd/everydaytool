<script setup lang="ts">
// 单选组内核：原生 role=radiogroup + provide/inject。
import { provide } from 'vue'

const modelValue = defineModel<string | number>({ required: true })

provide('uiRadioGroup', {
  value: () => modelValue.value,
  select: (v: string | number) => {
    modelValue.value = v
  },
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
