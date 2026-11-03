<script setup lang="ts">
// 折叠组内核：受控多开列表（modelValue 为展开的 name 数组）。
// 未传 modelValue 时内部自管(全部收起)。
import { provide } from 'vue'

const modelValue = defineModel<Array<string | number>>({ default: () => [] })

function isOpen(name: string | number) {
  return modelValue.value.includes(name)
}

function toggle(name: string | number) {
  const list = [...modelValue.value]
  const i = list.indexOf(name)
  if (i >= 0) {
    list.splice(i, 1)
  }
  else {
    list.push(name)
  }
  modelValue.value = list
}

provide('uiCollapse', { isOpen, toggle })
</script>

<template>
  <div class="ui-collapse">
    <slot />
  </div>
</template>
