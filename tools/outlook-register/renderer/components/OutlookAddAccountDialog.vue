<script setup lang="ts">
import { toast } from 'vue-sonner'
import { useOutlookRegisterStore } from '../stores/outlookRegisterStore'

const emit = defineEmits<{
  saved: [accountId: string]
}>()

const open = defineModel<boolean>({ required: true })
const store = useOutlookRegisterStore()

const email = ref('')
const password = ref('')
const recoveryEmail = ref('')
const note = ref('')
const saving = ref(false)

watch(open, (value) => {
  if (!value) return
  email.value = ''
  password.value = ''
  recoveryEmail.value = ''
  note.value = ''
})

async function save(): Promise<void> {
  const address = email.value.trim()
  if (!address) {
    toast.error('请填写 Outlook 邮箱地址')
    return
  }
  saving.value = true
  try {
    const account = await store.addAccount({
      email: address,
      password: password.value,
      recoveryEmail: recoveryEmail.value.trim(),
      note: note.value.trim(),
    })
    if (account) emit('saved', account.id)
    toast.success('账号已加入账号库')
    open.value = false
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiDialog v-model="open" title="添加已有账号" width="500px">
    <div class="add-form">
      <UiFormField label="邮箱" label-width="80px">
        <UiInput v-model="email" placeholder="name@outlook.com" />
      </UiFormField>
      <UiFormField label="密码" label-width="80px">
        <UiInput v-model="password" input-type="password" placeholder="可留空；留空后只能手动登录" />
      </UiFormField>
      <UiFormField label="辅助邮箱" label-width="80px">
        <UiInput v-model="recoveryEmail" placeholder="选填" />
      </UiFormField>
      <UiFormField label="备注" label-width="80px">
        <UiInput v-model="note" placeholder="选填，例如用途或创建日期" />
      </UiFormField>
      <UiHint block size="xs">
        已有账号首次打开邮箱需要在 Outlook 网页里登录一次，之后登录态保存在该账号独立的会话分区里。
      </UiHint>
    </div>
    <template #footer>
      <div class="add-footer">
        <UiButton @click="open = false">
          取消
        </UiButton>
        <UiButton type="primary" :loading="saving" @click="save">
          添加
        </UiButton>
      </div>
    </template>
  </UiDialog>
</template>

<style scoped lang="scss">
.add-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.add-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}
</style>
