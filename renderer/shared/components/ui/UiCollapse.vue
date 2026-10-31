<script setup lang="ts">
// 折叠组内核:EP el-collapse → 受控多开列表(modelValue 为展开的 name 数组)。
// 未传 modelValue 时内部自管(全部收起)。
import { provide, ref } from 'vue'

const props = defineProps<{
  modelValue?: Array<string | number>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Array<string | number>]
}>()

const internal = ref<Array<string | number>>([])

function isOpen(name: string | number) {
  const list = props.modelValue ?? internal.value
  return list.includes(name)
}

function toggle(name: string | number) {
  const list = [...(props.modelValue ?? internal.value)]
  const i = list.indexOf(name)
  if (i >= 0) {
    list.splice(i, 1)
  }
  else {
    list.push(name)
  }
  if (props.modelValue) {
    emit('update:modelValue', list)
  }
  else {
    internal.value = list
  }
}

provide('uiCollapse', { isOpen, toggle })
</script>

<template>
  <div class="ui-collapse">
    <slot />
  </div>
</template>
