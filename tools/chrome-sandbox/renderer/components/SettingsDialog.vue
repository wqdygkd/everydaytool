<script setup lang="ts">
import { useDialogVisible } from '@renderer/shared/composables/useDialogVisible'
import { appIpcChannels, invokeAppIpc } from '@renderer/shared/ipc/useAppIpc'
import { invokeIpc, ipcChannels } from '@renderer/shared/ipc/useIpc'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'saved'])

const loading = ref(false)
const form = reactive({
  chromePath: '',
  dataDirectory: '',
  autoRestoreOnStartup: false,
  preserveDataOnClose: true,
})
const visible = useDialogVisible(props, emit)
const channels = ipcChannels()
const appChannels = appIpcChannels()
// 打开时快照的目录值，用于判断用户是否真的改了数据目录
let initialDataDirectory = ''

watch(visible, async (open) => {
  if (!open) return
  const config = await invokeIpc(channels.CONFIG_GET)
  Object.assign(form, config)
  initialDataDirectory = form.dataDirectory
})

async function detectChrome() {
  try {
    const chromePath = await invokeIpc(channels.CHROME_DETECT_PATH)
    if (!chromePath) return
    form.chromePath = chromePath
    ElMessage.success('已检测到 Chrome')
  } catch (error) {
    ElMessage.error(error.message || '检测失败')
  }
}

async function save() {
  if (!form.dataDirectory.trim()) {
    ElMessage.warning('请选择或填写数据目录')
    return
  }

  loading.value = true
  try {
    // 数据目录是全局配置：必须走平台级通道，才能同时通知所有工具域重载（含环境浏览器）
    let dataDirectoryChanged = false
    if (form.dataDirectory.trim() && form.dataDirectory !== initialDataDirectory) {
      const result = await invokeAppIpc<{ changed: boolean }>(
        appChannels.DATA_DIRECTORY_UPDATE,
        form.dataDirectory.trim(),
      )
      dataDirectoryChanged = result?.changed === true
    }

    const { dataDirectory: _ignored, ...rest } = form
    const result = await invokeIpc(channels.CONFIG_UPDATE, { ...rest })
    ElMessage.success('设置已保存')
    visible.value = false
    emit('saved', { ...result, dataDirectoryChanged })
  } catch (error) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="全局设置" width="560px">
    <el-form :model="form" label-width="140px">
      <el-form-item label="Chrome 路径">
        <el-input v-model="form.chromePath" placeholder="自动检测或手动填写" />
      </el-form-item>
      <el-form-item label="数据目录">
        <DataDirectoryField v-model="form.dataDirectory" />
        <span class="form-hint">更改后会立即切换数据目录；已有沙箱数据不会自动迁移到新目录。</span>
      </el-form-item>
      <el-form-item label="启动时自动恢复">
        <el-switch v-model="form.autoRestoreOnStartup" />
      </el-form-item>
      <el-form-item label="关闭时保留数据">
        <el-switch v-model="form.preserveDataOnClose" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="detectChrome">
        检测 Chrome
      </el-button>
      <el-button type="primary" :loading="loading" @click="save">
        保存
      </el-button>
    </template>
  </el-dialog>
</template>
