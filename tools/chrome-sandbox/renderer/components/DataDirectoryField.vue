<script setup lang="ts">
import { invokeIpc, ipcChannels } from '@renderer/shared/ipc/useIpc'

defineProps({
  modelValue: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

async function pickDirectory() {
  try {
    const selected = await invokeIpc<string | null>(ipcChannels().CONFIG_SELECT_DATA_DIRECTORY)
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
