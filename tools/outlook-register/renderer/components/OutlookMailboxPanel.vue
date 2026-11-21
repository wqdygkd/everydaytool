<script setup lang="ts">
import type { OutlookAccount, OutlookMailboxSession } from '../../../../shared/outlook-register'
import type { OutlookWebviewTag } from '../webview'
import { useCopy } from '@renderer/shared/composables/useClipboard'
import { confirm } from '@renderer/shared/feedback'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { toast } from 'vue-sonner'
import ToolFormPane from '../../../../renderer/shared/components/workspace/ToolFormPane.vue'
import { OUTLOOK_MAILBOX_URL } from '../../../../shared/outlook-register'
import { useOutlookRegisterStore } from '../stores/outlookRegisterStore'
import { asOutlookWebview } from '../webview'

const props = defineProps<{
  active: boolean
}>()

const emit = defineEmits<{
  add: []
}>()

const store = useOutlookRegisterStore()
const filter = ref('')
const webviewRef = shallowRef<OutlookWebviewTag | null>(null)
const boundElements = new WeakSet<object>()
const session = ref<OutlookMailboxSession | null>(null)
const sessionNonce = ref(0)
const preparedId = ref('')
const preparing = ref(false)
const expandedId = ref<string | null>(null)
const editingId = ref<string | null>(null)
const savingEdit = ref(false)
const revealingPassword = ref(false)
const revealedPassword = ref('')

const editEmail = ref('')
const editPassword = ref('')
const editRecovery = ref('')
const editNote = ref('')
const editStatus = ref<string>('registered')

const statusOptions = [
  { label: '已注册', value: 'registered' },
  { label: '待确认', value: 'pending' },
]

let prepareToken = 0

const accounts = computed(() => store.accounts)
const selected = computed(() => store.selectedAccount)
const filteredAccounts = computed(() => {
  const query = filter.value.trim().toLowerCase()
  if (!query) return accounts.value
  return accounts.value.filter((account) => {
    const haystack = `${account.email} ${account.recoveryEmail} ${account.note}`.toLowerCase()
    return haystack.includes(query)
  })
})
const webviewKey = computed(() => session.value ? `${session.value.partition}:${sessionNonce.value}` : '')
const menuItems = computed(() => {
  const account = selected.value
  return [
    { command: 'details', label: '展开账号信息', icon: 'info' as const },
    { command: 'edit', label: '编辑账号', icon: 'pencil' as const },
    { command: 'copy-email', label: '复制邮箱', icon: 'copy' as const },
    { command: 'copy-password', label: '复制密码', icon: 'copy' as const },
    ...(account?.status === 'pending'
      ? [{ command: 'mark-registered', label: '标记为已注册', icon: 'toggle' as const }]
      : [{ command: 'mark-pending', label: '标记为待确认', icon: 'toggle' as const }]),
    { command: 'reset-session', label: '清除登录会话', icon: 'refresh' as const },
    { command: 'delete', label: '删除账号', icon: 'trash' as const, danger: true },
  ]
})

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('zh-CN')
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function profileName(account: OutlookAccount): string {
  return `${account.profile.firstName} ${account.profile.lastName}`.trim() || '—'
}

function birthLabel(account: OutlookAccount): string {
  const { birthYear, birthMonth, birthDay } = account.profile
  return `${birthYear}-${pad2(birthMonth)}-${pad2(birthDay)}`
}

function statusLabel(account: OutlookAccount): string {
  return account.status === 'pending' ? '待确认' : '已注册'
}

function statusTone(account: OutlookAccount): 'success' | 'warning' {
  return account.status === 'pending' ? 'warning' : 'success'
}

function bindWebview(value: unknown): void {
  const wv = asOutlookWebview(value)
  if (!wv) return
  webviewRef.value = wv
  if (boundElements.has(wv)) return
  boundElements.add(wv)

  wv.addEventListener('did-fail-load', (event) => {
    const detail = event as { errorDescription?: string, isMainFrame?: boolean }
    if (detail.isMainFrame === false) return
    if (detail.errorDescription && !/ERR_ABORTED/i.test(detail.errorDescription)) {
      toast.error(`页面加载失败：${detail.errorDescription}`)
    }
  })
}

async function prepareSelected(): Promise<void> {
  const account = selected.value
  if (!account) {
    prepareToken += 1
    preparing.value = false
    session.value = null
    preparedId.value = ''
    return
  }
  if (preparedId.value === account.id && session.value) return
  const token = ++prepareToken
  preparing.value = true
  try {
    const prepared = await store.prepareMailbox(account.id)
    if (token !== prepareToken) return
    session.value = prepared.session
    preparedId.value = account.id
    sessionNonce.value += 1
  } catch (error) {
    if (token !== prepareToken) return
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    if (token === prepareToken) preparing.value = false
  }
}

function resetExpandedState(): void {
  editingId.value = null
  editPassword.value = ''
  revealedPassword.value = ''
}

function toggleExpanded(account: OutlookAccount): void {
  if (expandedId.value === account.id) {
    expandedId.value = null
    resetExpandedState()
    return
  }
  expandedId.value = account.id
  resetExpandedState()
  if (store.selectedAccountId !== account.id) store.selectAccount(account.id)
}

function selectAccount(id: string): void {
  if (store.selectedAccountId !== id) store.selectAccount(id)
}

function showDetails(account: OutlookAccount): void {
  expandedId.value = account.id
  resetExpandedState()
}

function beginEdit(account: OutlookAccount): void {
  expandedId.value = account.id
  editingId.value = account.id
  editEmail.value = account.email
  editPassword.value = ''
  editRecovery.value = account.recoveryEmail
  editNote.value = account.note
  editStatus.value = account.status
  revealedPassword.value = ''
}

function cancelEdit(): void {
  editingId.value = null
  editPassword.value = ''
}

async function saveEdit(account: OutlookAccount): Promise<void> {
  savingEdit.value = true
  try {
    await store.updateAccount(account.id, {
      email: editEmail.value.trim(),
      recoveryEmail: editRecovery.value.trim(),
      note: editNote.value.trim(),
      status: editStatus.value as OutlookAccount['status'],
      ...(editPassword.value ? { password: editPassword.value } : {}),
    })
    editingId.value = null
    editPassword.value = ''
    revealedPassword.value = ''
    toast.success('账号资料已更新')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    savingEdit.value = false
  }
}

async function copyPassword(account: OutlookAccount): Promise<void> {
  try {
    const revealed = await store.revealPassword(account.id)
    if (revealed.failed) {
      toast.error('账号密码无法解密')
      return
    }
    if (!revealed.password) {
      toast.info('这个账号没有保存密码')
      return
    }
    await useCopy(revealed.password, '密码')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

async function togglePassword(account: OutlookAccount): Promise<void> {
  if (revealedPassword.value) {
    revealedPassword.value = ''
    return
  }
  revealingPassword.value = true
  try {
    const revealed = await store.revealPassword(account.id)
    if (revealed.failed) {
      toast.error('账号密码无法解密')
      return
    }
    if (!revealed.password) {
      toast.info('这个账号没有保存密码')
      return
    }
    revealedPassword.value = revealed.password
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    revealingPassword.value = false
  }
}

async function resetSession(): Promise<void> {
  const account = selected.value
  if (!account) return
  try {
    await confirm('会删除该账号在当前会话分区里的 Cookies / LocalStorage，下次打开邮箱需要重新登录。', '清除登录会话？', {
      type: 'warning',
      confirmButtonText: '清除',
    })
  } catch {
    return
  }
  try {
    await store.resetSession(account.id)
    preparedId.value = ''
    session.value = null
    if (props.active) await prepareSelected()
    toast.success('登录会话已清除')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

async function removeAccount(): Promise<void> {
  const account = selected.value
  if (!account) return
  try {
    await confirm(`会从账号库删除 ${account.email}，并清除它的登录会话。此操作不可撤销。`, '删除账号？', {
      type: 'error',
      confirmButtonText: '删除',
    })
  } catch {
    return
  }
  try {
    await store.deleteAccount(account.id)
    toast.success('账号已删除')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

async function setStatus(status: 'pending' | 'registered'): Promise<void> {
  const account = selected.value
  if (!account) return
  try {
    await store.updateAccount(account.id, { status })
    toast.success(status === 'registered' ? '已标记为已注册' : '已标记为待确认')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

async function onMenuCommand(command: string): Promise<void> {
  const account = selected.value
  if (!account) return
  switch (command) {
    case 'details':
      showDetails(account)
      break
    case 'edit':
      beginEdit(account)
      break
    case 'copy-email':
      await useCopy(account.email, '邮箱')
      break
    case 'copy-password':
      await copyPassword(account)
      break
    case 'mark-registered':
      await setStatus('registered')
      break
    case 'mark-pending':
      await setStatus('pending')
      break
    case 'reset-session':
      await resetSession()
      break
    case 'delete':
      await removeAccount()
      break
  }
}

watch(() => store.selectedAccountId, (id) => {
  prepareToken += 1
  preparedId.value = ''
  session.value = null
  preparing.value = false
  if (expandedId.value && expandedId.value !== id) {
    expandedId.value = null
    resetExpandedState()
  }
  if (props.active) void prepareSelected()
})

watch(() => props.active, (active) => {
  if (active && !session.value) void prepareSelected()
})

onMounted(async () => {
  try {
    if (!store.state) await store.refresh()
    store.ensureSelection()
    if (props.active) await prepareSelected()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
})
</script>

<template>
  <div class="mailbox-panel">
    <ToolFormPane title="账号库">
      <template #actions>
        <UiButton size="small" text @click="emit('add')">
          添加账号
        </UiButton>
      </template>

      <div class="account-search">
        <UiSearchInput v-model="filter" variant="box" clearable placeholder="搜索邮箱 / 备注" />
      </div>

      <div v-if="filteredAccounts.length" class="account-list">
        <UiListCard
          v-for="account in filteredAccounts"
          :key="account.id"
          :active="account.id === store.selectedAccountId"
          @click="selectAccount(account.id)"
        >
          <div class="account-card">
            <div class="account-card-main">
              <span class="account-email mono" :title="account.email">{{ account.email }}</span>
              <UiChip :tone="statusTone(account)">
                {{ statusLabel(account) }}
              </UiChip>
              <UiIconButton
                class="expand-toggle"
                :class="{ 'is-open': expandedId === account.id }"
                icon="chevronDown"
                :size="24"
                :label="expandedId === account.id ? '收起账号信息' : '展开账号信息'"
                @keydown.stop
                @click.stop="toggleExpanded(account)"
              />
            </div>
            <div class="account-card-meta">
              <span>最近打开 {{ formatDate(account.lastMailboxOpenedAt) }}</span>
              <span v-if="account.recoveryEmail">辅助 {{ account.recoveryEmail }}</span>
            </div>
            <p v-if="account.note" class="account-note">
              {{ account.note }}
            </p>

            <div v-if="expandedId === account.id" class="account-expand" @click.stop @keydown.stop>
              <template v-if="editingId === account.id">
                <div class="expand-form">
                  <UiFormField label="邮箱" label-width="64px">
                    <UiInput v-model="editEmail" placeholder="name@outlook.com" />
                  </UiFormField>
                  <UiFormField label="新密码" label-width="64px">
                    <UiInput v-model="editPassword" input-type="password" placeholder="留空表示不修改" />
                  </UiFormField>
                  <UiFormField label="辅助邮箱" label-width="64px">
                    <UiInput v-model="editRecovery" placeholder="选填" />
                  </UiFormField>
                  <UiFormField label="状态" label-width="64px">
                    <UiSelect v-model="editStatus" :options="statusOptions" />
                  </UiFormField>
                  <UiFormField label="备注" label-width="64px">
                    <UiInput v-model="editNote" placeholder="选填" />
                  </UiFormField>
                </div>
                <div class="expand-actions">
                  <UiButton size="small" @click="cancelEdit">
                    取消
                  </UiButton>
                  <UiButton type="primary" size="small" :loading="savingEdit" @click="saveEdit(account)">
                    保存
                  </UiButton>
                </div>
              </template>

              <template v-else>
                <UiDetailGrid :columns="1" class="expand-grid">
                  <UiDetailItem label="密码" size="xs">
                    <div class="detail-value-line">
                      <span class="detail-text mono">{{ revealedPassword || '••••••••••••' }}</span>
                      <UiButton size="small" text :loading="revealingPassword" @click="togglePassword(account)">
                        {{ revealedPassword ? '隐藏' : '显示' }}
                      </UiButton>
                      <UiIconButton icon="copy" :size="24" label="复制密码" @click="copyPassword(account)" />
                    </div>
                  </UiDetailItem>
                  <UiDetailItem label="姓名" size="xs">
                    {{ profileName(account) }}
                  </UiDetailItem>
                  <UiDetailItem label="出生日期" size="xs" mono>
                    {{ birthLabel(account) }}
                  </UiDetailItem>
                  <UiDetailItem label="辅助邮箱" size="xs">
                    <div class="detail-value-line">
                      <span class="detail-text">{{ account.recoveryEmail || '—' }}</span>
                      <UiCopyButton v-if="account.recoveryEmail" :text="account.recoveryEmail" label="辅助邮箱" />
                    </div>
                  </UiDetailItem>
                  <UiDetailItem label="创建时间" size="xs">
                    {{ formatDateTime(account.createdAt) }}
                  </UiDetailItem>
                  <UiDetailItem label="最近更新" size="xs">
                    {{ formatDateTime(account.updatedAt) }}
                  </UiDetailItem>
                  <UiDetailItem label="最近打开邮箱" size="xs">
                    {{ formatDateTime(account.lastMailboxOpenedAt) }}
                  </UiDetailItem>
                  <UiDetailItem label="会话分区" size="xs" mono wrap>
                    {{ account.partition }}
                  </UiDetailItem>
                </UiDetailGrid>
                <div v-if="account.note" class="expand-note">
                  {{ account.note }}
                </div>
                <div class="expand-actions">
                  <UiButton size="small" text @click="beginEdit(account)">
                    编辑资料
                  </UiButton>
                </div>
              </template>
            </div>
          </div>
        </UiListCard>
      </div>

      <UiEmpty
        v-else-if="!accounts.length"
        class="account-empty"
        center
        icon="outlook"
        title="账号库还是空的"
        text="完成一次注册后保存，或把已有账号添加进来。"
      >
        <template #actions>
          <UiButton type="primary" size="small" @click="emit('add')">
            添加账号
          </UiButton>
        </template>
      </UiEmpty>

      <UiEmpty
        v-else
        class="account-empty"
        center
        icon="search"
        title="没有匹配的账号"
        text="换个关键词，或清空搜索。"
      />
    </ToolFormPane>

    <div class="mailbox-stage">
      <header class="stage-bar">
        <template v-if="selected">
          <span class="stage-email mono" :title="selected.email">{{ selected.email }}</span>
          <UiChip tone="primary" variant="soft">
            邮箱页面
          </UiChip>
          <span class="stage-spacer" />
          <UiIconButton icon="refresh" label="刷新邮箱" @click="webviewRef?.reload()" />
          <UiIconButton icon="external" label="在系统浏览器打开" @click="openExternal(OUTLOOK_MAILBOX_URL)" />
          <UiDropdown :items="menuItems" @command="onMenuCommand">
            <template #trigger>
              <UiIconButton icon="more" label="账号操作" />
            </template>
          </UiDropdown>
        </template>
        <span v-else class="stage-email">没有选中账号</span>
      </header>

      <webview
        v-if="session && webviewKey"
        :key="webviewKey"
        :ref="bindWebview"
        class="mailbox-webview"
        :src="session.url"
        :partition="session.partition"
        allowpopups
        webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
      />
      <UiEmpty
        v-else-if="preparing"
        class="mailbox-empty"
        center
        icon="refresh"
        title="正在准备邮箱会话"
        text="正在应用代理并挂载独立登录分区。"
      />
      <UiEmpty
        v-else-if="!accounts.length"
        class="mailbox-empty"
        center
        icon="outlook"
        title="先添加或注册一个 Outlook 账号"
        text="账号的登录态会独立保存，不会与其它账号互相顶掉。"
      >
        <template #actions>
          <UiButton type="primary" size="small" @click="emit('add')">
            添加账号
          </UiButton>
        </template>
      </UiEmpty>
      <UiEmpty
        v-else
        class="mailbox-empty"
        center
        icon="outlook"
        title="选择一个账号"
        text="从左侧账号库选择邮箱，收件箱会显示在这里。"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.mailbox-panel {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.account-search {
  flex: none;
  margin-bottom: 12px;
}

.account-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.account-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.account-card-main {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
}

.account-email {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expand-toggle {
  flex: none;
  transition: transform var(--transition-fast);

  &.is-open {
    transform: rotate(180deg);
  }
}

.account-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.account-note {
  margin: 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-expand {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-light);
  cursor: default;
}

.expand-grid {
  gap: var(--spacing-sm);
}

.expand-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.expand-note {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  white-space: pre-wrap;
  word-break: break-word;
}

.expand-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-sm);
}

.detail-value-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.detail-text {
  min-width: 0;
  word-break: break-all;
}

.account-empty {
  padding-top: 28px;
}

.mailbox-stage {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.stage-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex: 0 0 48px;
  min-width: 0;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--color-border-light);
}

.stage-email {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-spacer {
  flex: 1;
}

.mailbox-webview {
  flex: 1;
  width: 100%;
  min-height: 0;
  border: 0;
}

.mailbox-empty {
  flex: 1;
  justify-content: center;
  padding: 28px;
}
</style>
