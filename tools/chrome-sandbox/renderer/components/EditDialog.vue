<script setup lang="ts">
import type { Sandbox } from '../../../../shared/sandbox'
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
const INITIAL_FORM = {
  name: '',
  ...LAUNCH_OPTION_FORM_FIELDS,
}
const form = reactive({ ...INITIAL_FORM })
const visible = useDialogVisible(props, emit)

watch(visible, (open) => {
  if (open && props.sandbox) {
    loadForm(props.sandbox)
  }
})

function reset() {
  Object.assign(form, INITIAL_FORM)
}

// props.sandbox 运行期声明为 Object（类型即 Record<string, any>），参数类型随之放宽到
// Partial<Sandbox>：既接受父级传入的宽松对象，又保留字段名与字段类型的校验
function loadForm(sandbox: Partial<Sandbox>) {
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
    // 关闭动作等价于 useDialogVisible 的 setter：直接通知父级改 modelValue
    emit('update:modelValue', false)
    reset()
  } catch (error) {
    ElMessage.error((error as Error).message || '保存失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UiDialog v-model="visible" title="编辑沙箱设置" width="420px" @close="reset">
    <el-form :model="form" label-width="120px">
      <el-form-item label="名称">
        <el-input v-model="form.name" placeholder="沙箱名称" />
      </el-form-item>
      <el-form-item label="启动参数">
        <LaunchOptionsFields :form="form" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">
        取消
      </el-button>
      <el-button type="primary" :loading="loading" @click="save">
        保存
      </el-button>
    </template>
  </UiDialog>
</template>
