<script setup lang="ts">
import type { OutlookDomain } from '../../../../shared/outlook-register'
import { toast } from 'vue-sonner'
import { OUTLOOK_DOMAINS } from '../../../../shared/outlook-register'
import { useOutlookRegisterStore } from '../stores/outlookRegisterStore'

const open = defineModel<boolean>({ required: true })
const store = useOutlookRegisterStore()

const domain = ref<OutlookDomain>('@outlook.com')
const proxy = ref('')
const saving = ref(false)
const secretsAvailable = computed(() => store.state?.secretsAvailable !== false)

watch(open, (value) => {
  if (!value) return
  domain.value = store.settings?.domain ?? '@outlook.com'
  proxy.value = store.settings?.proxy ?? ''
})

const domainOptions = OUTLOOK_DOMAINS.map(item => ({ label: item, value: item }))

async function save(): Promise<void> {
  saving.value = true
  try {
    await store.updateSettings({
      domain: domain.value,
      proxy: proxy.value,
    })
    toast.success('设置已保存，代理会应用到所有 Outlook 会话')
    open.value = false
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UiDialog v-model="open" title="Outlook 注册设置" width="480px">
    <div class="settings-form">
      <UiFormField label="默认后缀" label-width="88px">
        <UiSelect v-model="domain" :options="domainOptions" />
      </UiFormField>
      <UiFormField label="代理" label-width="88px">
        <UiInput v-model="proxy" placeholder="http://127.0.0.1:7897（留空直连）" />
      </UiFormField>
      <UiHint block size="xs">
        代理只作用于软件内的邮箱 webview；在外部浏览器注册时不受这里影响。登录邮箱的 IP 变化可能触发额外验证。
      </UiHint>
      <UiHint block size="xs">
        密码默认使用系统加密信封保存；系统加密不可用时会在下方提示。
      </UiHint>
      <UiAlert
        v-if="!secretsAvailable"
        type="warning"
        :closable="false"
        show-icon
        title="系统加密不可用"
        description="密码会以明文写入本地 JSON，请确保数据目录所在磁盘已加密或访问权限可靠。"
      />
    </div>
    <template #footer>
      <div class="settings-footer">
        <UiButton @click="open = false">
          取消
        </UiButton>
        <UiButton type="primary" :loading="saving" @click="save">
          保存
        </UiButton>
      </div>
    </template>
  </UiDialog>
</template>

<style scoped lang="scss">
.settings-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}
</style>
