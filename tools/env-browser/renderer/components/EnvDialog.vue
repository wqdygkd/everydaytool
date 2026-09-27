<script setup lang="ts">
import type { EnvConfig } from '../stores/envStore'

import { useEnvBrowserStore } from '../stores/envStore'

const props = defineProps<{
  modelValue: boolean
  editing?: EnvConfig | null
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved'): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const formRef = ref()
const form = reactive({
  name: '',
  url: '',
  username: '',
  password: '',
  remark: '',
  autoLogin: true,
})

function resetForm(val?: EnvConfig | null) {
  form.name = val?.name || ''
  form.url = val?.url || ''
  form.username = val?.username || ''
  form.password = val?.password || ''
  form.remark = val?.remark || ''
  form.autoLogin = val ? val.autoLogin !== 0 : true
}

watch(
  () => [props.modelValue, props.editing] as const,
  ([visible, editing]) => {
    if (visible) resetForm(editing)
  },
  { immediate: true },
)

const rules = {
  name: [{ required: true, message: '请输入环境名称', trigger: 'blur' }],
  url: [{ required: true, message: '请输入环境地址', trigger: 'blur' }],
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}
const store = useEnvBrowserStore()
const saving = ref(false)

async function onSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  // 校验 URL
  try {
    const u = new URL(form.url)
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error()
  } catch {
    ElMessage.error('地址需以 http:// 或 https:// 开头')
    return
  }
  saving.value = true
  try {
    if (props.editing) {
      await store.update(props.editing.id, {
        name: form.name.trim(),
        url: form.url.trim(),
        username: form.username.trim(),
        password: form.password,
        remark: form.remark.trim(),
        autoLogin: form.autoLogin,
      })
      ElMessage.success('已更新')
    } else {
      await store.create({
        name: form.name.trim(),
        url: form.url.trim(),
        username: form.username.trim(),
        password: form.password,
        remark: form.remark.trim(),
        autoLogin: form.autoLogin,
      })
      ElMessage.success('已创建')
    }
    visible.value = false
    emit('saved')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    ElMessage.error(msg || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="editing ? '编辑环境' : '新增环境'"
    width="560px"
    destroy-on-close
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="环境名称" prop="name">
        <el-input v-model="form.name" placeholder="如：测试环境 / 预发布 / 客户A" maxlength="40" />
      </el-form-item>
      <el-form-item label="环境地址" prop="url">
        <el-input v-model="form.url" placeholder="https://example.com/login" />
      </el-form-item>
      <el-form-item label="账号" prop="username">
        <el-input v-model="form.username" placeholder="登录账号 / 邮箱 / 手机号" />
      </el-form-item>
      <el-form-item label="密码" prop="password">
        <el-input v-model="form.password" type="password" show-password placeholder="登录密码" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="可选备注" maxlength="200" />
      </el-form-item>
      <el-form-item label="自动登录">
        <el-switch v-model="form.autoLogin" />
        <span class="muted" style="margin-left:8px;font-size:var(--font-size-sm)">打开环境时自动填充并尝试提交</span>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">
        取消
      </el-button>
      <el-button type="primary" :loading="saving" @click="onSubmit">
        {{ editing ? '保存' : '创建' }}
      </el-button>
    </template>
  </el-dialog>
</template>
