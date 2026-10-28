<script setup lang="ts">
import { appIpcChannels, invokeAppIpc } from '@renderer/shared/ipc/useAppIpc'

defineProps({
  modelValue: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

async function pickDirectory() {
  try {
    const selected = await invokeAppIpc<string | null>(appIpcChannels().DATA_DIRECTORY_SELECT)
    if (selected) {
      emit('update:modelValue', selected)
    }
  } catch (error) {
    ElMessage.error((error as Error).message || '选择目录失败')
  }
}
</script>

<template>
  <UiPathField
    :model-value="modelValue"
    placeholder="数据目录（所有工具共用）"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #actions>
      <el-button @click="pickDirectory">
        选择
      </el-button>
    </template>
  </UiPathField>
</template>
