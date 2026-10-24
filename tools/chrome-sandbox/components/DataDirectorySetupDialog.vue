<script setup lang="ts">
import { appCommands, invokeAppCommand } from '@/shared/commands/useAppCommands'
import { useDialogVisible } from '@/shared/composables/useDialogVisible'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'completed', 'cancel'])

const loading = ref(false)
const dataDirectory = ref('')
const saved = ref(false)
const visible = useDialogVisible(props, emit)

watch(visible, (open) => {
  if (!open) return
  saved.value = false
  dataDirectory.value = ''
})

function cancel() {
  visible.value = false
}

function handleClose() {
  if (saved.value) return
  emit('cancel')
}

async function save() {
  const trimmed = dataDirectory.value.trim()
  if (!trimmed) {
    ElMessage.warning('请选择或填写数据目录')
    return
  }

  loading.value = true
  try {
    // 首次引导同样走平台级通道，保证所有工具域都切换到新目录
    const result = await invokeAppCommand<{ changed: boolean }>(appCommands().DATA_DIRECTORY_UPDATE, trimmed)
    saved.value = true
    visible.value = false
    emit('completed', result)
  } catch (error) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UiDialog
    v-model="visible"
    title="首次使用 - 设置数据目录"
    width="520px"
    :close-on-click-modal="false"
    @close="handleClose"
  >
    <p class="setup-intro">
      请选择沙箱与配置文件的存储位置，完成后才能使用 Chrome 沙箱。
    </p>
    <el-form label-width="100px">
      <el-form-item label="数据目录">
        <DataDirectoryField v-model="dataDirectory" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="cancel">
        返回主页
      </el-button>
      <el-button type="primary" :loading="loading" @click="save">
        保存并继续
      </el-button>
    </template>
  </UiDialog>
</template>

<style scoped lang="scss">
.setup-intro {
  margin: 0 0 var(--spacing-lg);
  color: var(--color-text-secondary);
  line-height: 1.5;
}
</style>
