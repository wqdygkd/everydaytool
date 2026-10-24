<script setup lang="ts">
import { appCommands, invokeAppCommand } from '@/shared/commands/useAppCommands'

defineProps({
  modelValue: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

async function pickDirectory() {
  try {
    const selected = await invokeAppCommand<string | null>(appCommands().DATA_DIRECTORY_SELECT)
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
    placeholder="沙箱与配置文件存储位置"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #actions>
      <el-button @click="pickDirectory">
        选择
      </el-button>
    </template>
  </UiPathField>
</template>
