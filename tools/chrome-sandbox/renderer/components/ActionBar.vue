<template>
  <div class="action-bar">
    <el-button type="primary" @click="$emit('activate')">
      {{ activateLabel }}
    </el-button>
    <el-button :disabled="!running" @click="$emit('close')">关闭</el-button>
    <el-button @click="$emit('edit-settings')">编辑设置</el-button>
    <el-button @click="$emit('edit-fingerprint')">编辑指纹</el-button>
    <el-button type="danger" plain @click="confirmDelete">删除</el-button>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  running: { type: Boolean, default: false },
});

const emit = defineEmits(['activate', 'close', 'delete', 'edit-fingerprint', 'edit-settings']);

const activateLabel = computed(() => (props.running ? '激活窗口' : '启动沙箱'));

async function confirmDelete() {
  try {
    await ElMessageBox.confirm('确定删除该沙箱？此操作不可恢复。', '删除确认', { type: 'warning' });
    emit('delete');
  } catch {
    // cancelled
  }
}
</script>
