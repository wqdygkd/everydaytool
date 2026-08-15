<template>
  <div class="data-directory-row">
    <el-input
      :model-value="modelValue"
      placeholder="沙箱与配置文件存储位置"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <el-button @click="pickDirectory">选择</el-button>
  </div>
</template>

<script setup lang="ts">
import { useDataDirectoryPicker } from '../composables/useDataDirectoryPicker.js';

defineProps({
  modelValue: { type: String, default: '' },
});

const emit = defineEmits(['update:modelValue']);

const { browseDataDirectory } = useDataDirectoryPicker();

async function pickDirectory() {
  const selected = await browseDataDirectory();
  if (selected) {
    emit('update:modelValue', selected);
  }
}
</script>

<style scoped>
.data-directory-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.data-directory-row .el-input {
  flex: 1;
}
</style>
