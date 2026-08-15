<script setup lang="ts">
import { useDialogVisible } from '@renderer/shared/composables/useDialogVisible'
import {
  buildLaunchOptionsPayload,
  LAUNCH_OPTION_FORM_FIELDS,
  syncLaunchOptionsForm,
} from '../shared/launchOptions'
import { useSandboxStore } from '../stores/sandboxStore'

const props = defineProps({
  modelValue: Boolean,
  sandbox: { type: Object, default: null },
})
const emit = defineEmits(['update:modelValue'])

const store = useSandboxStore()
const loading = ref(false)
const form = reactive({
  name: '',
  ...LAUNCH_OPTION_FORM_FIELDS,
})
const visible = useDialogVisible(props, emit)

watch(visible, (open) => {
  if (open && props.sandbox) {
    loadForm(props.sandbox)
  }
})

function reset() {
  Object.assign(form, { name: '', ...LAUNCH_OPTION_FORM_FIELDS })
}

function loadForm(sandbox) {
  reset()
  form.name = sandbox.name || ''
  syncLaunchOptionsForm(form, sandbox.metadata?.launchOptions)
}

async function save() {
  if (!props.sandbox) return

  const name = form.name.trim()
  if (!name) {
    ElMessage.warning('请输入沙箱名称')
    return
  }

  loading.value = true
  try {
    await store.update(props.sandbox.id, {
      name,
      metadata: {
        ...(props.sandbox.metadata || {}),
        launchOptions: buildLaunchOptionsPayload(form),
      },
    })
    ElMessage.success('设置已保存')
    visible.value = false
    reset()
  } catch (error) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="编辑沙箱设置" width="420px" @close="reset">
    <el-form :model="form" label-width="120px">
      <el-form-item label="名称">
        <el-input v-model="form.name" placeholder="沙箱名称" />
      </el-form-item>
      <el-form-item label="启动参数">
        <LaunchOptionsFields :form="form" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">
        取消
      </el-button>
      <el-button type="primary" :loading="loading" @click="save">
        保存
      </el-button>
    </template>
  </el-dialog>
</template>
