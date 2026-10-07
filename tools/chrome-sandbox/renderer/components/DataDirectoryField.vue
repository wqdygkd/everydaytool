<script setup lang="ts">
import { appIpcChannels, invokeAppIpc } from '@renderer/shared/ipc/useAppIpc'

defineProps({
  modelValue: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

async function pickDirectory() {
  try {
    const selected = await invokeAppIpc<string | null>(appIpcChannels.DATA_DIRECTORY_SELECT)
    if (selected) {
      emit('update:modelValue', selected)
    }
  } catch (error) {
    ElMessage.error((error as Error).message || '选择目录失败')
  }
}
</script>

<template>
  <div class="data-directory-row inline-group">
    <el-input
      :model-value="modelValue"
      placeholder="沙箱与配置文件存储位置"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <el-button @click="pickDirectory">
      选择
    </el-button>
  </div>
</template>

<style scoped lang="scss">
.data-directory-row {
  width: 100%;

  .el-input {
    flex: 1;
  }
}
</style>
