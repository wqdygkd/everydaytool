<script setup lang="ts">
import { useDialogVisible } from '@renderer/shared/composables/useDialogVisible'
import {
  buildLaunchOptionsPayload,
  LAUNCH_OPTION_FORM_FIELDS,
} from '../shared/launchOptions'
import { useSandboxStore } from '../stores/sandboxStore'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])

const store = useSandboxStore()
const loading = ref(false)
const INITIAL_FORM = {
  name: '',
  inheritExtensions: false,
  ...LAUNCH_OPTION_FORM_FIELDS,
}
const form = reactive({ ...INITIAL_FORM })
const visible = useDialogVisible(props, emit)

function reset() {
  Object.assign(form, INITIAL_FORM)
}

async function submit() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入沙箱名称')
    return
  }

  loading.value = true
  try {
    await store.create({
      name: form.name.trim(),
      inheritExtensions: form.inheritExtensions,
      launchOptions: buildLaunchOptionsPayload(form),
    })
    ElMessage.success('沙箱创建成功')
    visible.value = false
    reset()
  } catch (error) {
    ElMessage.error(error.message || '创建失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="新建沙箱" width="420px" @close="reset">
    <el-form :model="form" label-width="120px">
      <el-form-item label="名称">
        <el-input v-model="form.name" placeholder="例如：工作账号 A" />
      </el-form-item>
      <el-form-item label="继承扩展">
        <el-switch v-model="form.inheritExtensions" />
        <span class="form-hint">开启后从系统 Chrome 复制已安装扩展（较慢、占用更多磁盘）</span>
      </el-form-item>
      <el-form-item label="启动参数">
        <LaunchOptionsFields :form="form" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">
        取消
      </el-button>
      <el-button type="primary" :loading="loading" @click="submit">
        创建
      </el-button>
    </template>
  </el-dialog>
</template>
