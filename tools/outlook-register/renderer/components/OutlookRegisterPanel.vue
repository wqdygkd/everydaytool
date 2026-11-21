<script setup lang="ts">
import { confirm } from '@renderer/shared/feedback'
import { toast } from 'vue-sonner'
import ToolFormSection from '../../../../renderer/shared/components/workspace/ToolFormSection.vue'
import { OUTLOOK_DOMAINS } from '../../../../shared/outlook-register'
import { useOutlookRegisterStore } from '../stores/outlookRegisterStore'
import OutlookPasswordDialog from './OutlookPasswordDialog.vue'

const emit = defineEmits<{
  saved: [accountId: string]
}>()

const store = useOutlookRegisterStore()
const passwordVisible = ref(false)
const passwordDialogOpen = ref(false)
const saving = ref(false)
const recoveryDraft = ref('')
const domainDraft = ref('@outlook.com')

const draft = computed(() => store.draft)
const domainOptions = OUTLOOK_DOMAINS.map(item => ({ label: item, value: item }))
const displayPassword = computed(() => {
  const value = draft.value?.password ?? ''
  if (!value) return '—'
  return passwordVisible.value ? value : '•'.repeat(Math.min(value.length, 18))
})
const birthLabel = computed(() => {
  const profile = draft.value?.profile
  if (!profile) return '—'
  return `${profile.birthYear}-${String(profile.birthMonth).padStart(2, '0')}-${String(profile.birthDay).padStart(2, '0')}`
})
const nameLabel = computed(() => {
  const profile = draft.value?.profile
  return profile ? `${profile.firstName} ${profile.lastName}` : '—'
})

async function ensureDraft(): Promise<void> {
  try {
    await store.refresh()
    if (!store.draft) await store.createDraft(false)
    domainDraft.value = store.draft?.domain ?? '@outlook.com'
    recoveryDraft.value = store.draft?.recoveryEmail ?? ''
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

async function regenerate(): Promise<void> {
  try {
    await confirm('会生成新的邮箱、密码和姓名，已保存的账号不受影响。', '重新生成注册资料？', {
      type: 'warning',
      confirmButtonText: '重新生成',
    })
  } catch {
    return
  }
  try {
    await store.createDraft(true)
    domainDraft.value = store.draft?.domain ?? '@outlook.com'
    recoveryDraft.value = store.draft?.recoveryEmail ?? ''
    passwordVisible.value = false
    toast.success('已生成新的注册资料')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

async function changeDomain(value: string): Promise<void> {
  const next = OUTLOOK_DOMAINS.find(item => item === value)
  if (!next) return
  domainDraft.value = next
  try {
    await store.updateDraft({ domain: next })
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

async function saveRecoveryEmail(): Promise<void> {
  if ((store.draft?.recoveryEmail ?? '') === recoveryDraft.value.trim()) return
  try {
    await store.updateDraft({ recoveryEmail: recoveryDraft.value })
    toast.success(recoveryDraft.value.trim() ? '辅助邮箱已保存到草稿' : '已清空辅助邮箱')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

async function saveAccount(): Promise<void> {
  if (!store.draft) {
    toast.info('当前没有待保存的注册草稿')
    return
  }
  saving.value = true
  try {
    const account = await store.saveDraft()
    if (!account) {
      toast.info('草稿已不存在，请刷新后重试')
      return
    }
    toast.success('账号已保存到账号库')
    emit('saved', account.id)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    saving.value = false
  }
}

function onPasswordApplied(): void {
  passwordVisible.value = true
}

watch(draft, (value) => {
  if (!value) return
  domainDraft.value = value.domain
  recoveryDraft.value = value.recoveryEmail
}, { deep: true })

onMounted(ensureDraft)
</script>

<template>
  <div class="register-panel">
    <div class="register-column">
      <ToolFormSection title="账号" description="生成邮箱与密码，在外部浏览器完成注册">
        <template #actions>
          <UiButton size="small" text @click="regenerate">
            重新生成
          </UiButton>
        </template>
        <UiFormField label="邮箱" label-width="72px">
          <div class="copy-row">
            <span class="copy-value mono">{{ draft?.email ?? '—' }}</span>
            <UiCopyButton :text="draft?.email ?? ''" label="邮箱" />
          </div>
        </UiFormField>
        <UiFormField label="密码" label-width="72px">
          <div class="password-block">
            <div class="copy-row">
              <span class="copy-value mono">{{ displayPassword }}</span>
              <UiButton size="small" text @click="passwordVisible = !passwordVisible">
                {{ passwordVisible ? '隐藏' : '显示' }}
              </UiButton>
              <UiCopyButton :text="draft?.password ?? ''" label="密码" />
            </div>
            <div class="password-actions">
              <UiButton size="small" text @click="passwordDialogOpen = true">
                生成复杂密码
              </UiButton>
            </div>
          </div>
        </UiFormField>
        <UiFormField label="后缀" label-width="72px">
          <UiSelect :model-value="domainDraft" :options="domainOptions" @update:model-value="changeDomain" />
        </UiFormField>
      </ToolFormSection>

      <ToolFormSection title="个人资料" description="用于注册表单，可随草稿重新生成">
        <div class="kv-list">
          <UiKeyValue label="姓名" label-width="52px">
            {{ nameLabel }}
          </UiKeyValue>
          <UiKeyValue label="生日" label-width="52px" mono>
            {{ birthLabel }}
          </UiKeyValue>
        </div>
      </ToolFormSection>

      <ToolFormSection title="辅助邮箱" description="选填；注册时由你自己决定是否填写" :divider="false">
        <UiFormField label="邮箱" label-width="72px">
          <UiInput
            v-model="recoveryDraft"
            placeholder="recovery@example.com"
            @blur="saveRecoveryEmail"
          />
        </UiFormField>
      </ToolFormSection>

      <div class="save-block">
        <UiButton type="primary" :loading="saving" :disabled="!draft" @click="saveAccount">
          保存到账号库
        </UiButton>
        <UiHint size="xs">
          软件内不加载注册页；在外部浏览器注册成功后点这里入库，邮箱、密码与资料会一起保存。
        </UiHint>
      </div>
    </div>

    <OutlookPasswordDialog v-model="passwordDialogOpen" @applied="onPasswordApplied" />
  </div>
</template>

<style scoped lang="scss">
.register-panel {
  display: flex;
  flex: 1;
  justify-content: center;
  min-height: 0;
  padding: 24px;
  overflow-y: auto;
}

.register-column {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: min(720px, 100%);
  min-width: 0;
}

.copy-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
}

.copy-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.password-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.password-actions {
  display: flex;
  gap: 4px;
}

.kv-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.save-block {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding-top: 16px;
  border-top: 1px solid var(--color-border-light);
}
</style>
