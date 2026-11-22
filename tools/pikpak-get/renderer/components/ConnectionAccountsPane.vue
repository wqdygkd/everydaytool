<script setup lang="ts">
import type { PikpakGetEngineMode, PikpakGetExport } from '../../../../shared/pikpak-get'
import { toast } from 'vue-sonner'
import { humanPikpakBytes } from '../../../../shared/pikpak-get'
import { usePikpakGetStore } from '../stores/pikpakGetStore'

const store = usePikpakGetStore()

const accounts = computed(() => store.accounts)
const whoamiMap = computed(() => store.whoami)
const connection = computed(() => store.connection)
const connected = computed(() => Boolean(store.connection))

const mode = ref<PikpakGetEngineMode>('nas')
const showConnectionForm = ref(false)
const connectionName = ref('')
const connectionUrl = ref('')
const connectionToken = ref('')

const loginLabel = ref('')
const loginPassword = ref('')
const busyLogin = ref(false)

const revealed = ref<Record<string, string>>({})
const whoamiBusy = ref<Record<string, boolean>>({})

function openConnectionForm(): void {
  connectionName.value = store.connection?.name ?? ''
  connectionUrl.value = store.connection?.url ?? ''
  connectionToken.value = ''
  mode.value = store.connection?.mode ?? 'nas'
  showConnectionForm.value = true
}

async function saveConnection(): Promise<void> {
  try {
    await store.saveConnection({
      mode: mode.value,
      name: connectionName.value || undefined,
      url: mode.value === 'nas' ? connectionUrl.value : undefined,
      token: mode.value === 'nas' ? (connectionToken.value || undefined) : undefined,
    })
    showConnectionForm.value = false
    toast.success('引擎连接已保存')
    await store.refreshAccounts()
    await store.refreshLinks()
    await store.refreshTasks()
  } catch (error) {
    toast.error((error as Error).message || '保存失败')
  }
}

function switchMode(next: PikpakGetEngineMode): void {
  mode.value = next
}

async function testConnection(): Promise<void> {
  try {
    await store.testConnection()
    toast.success('引擎连接正常')
  } catch (error) {
    toast.error((error as Error).message || '引擎连接失败')
  }
}

const exportOpen = ref(false)
const importOpen = ref(false)
const exportText = ref('')
const importText = ref('')
const busyImport = ref(false)

async function doExport(): Promise<void> {
  try {
    const data = await store.exportData()
    exportText.value = JSON.stringify(data, null, 2)
    exportOpen.value = true
  } catch (error) {
    toast.error((error as Error).message || '导出失败')
  }
}

async function copyExport(): Promise<void> {
  try {
    await navigator.clipboard.writeText(exportText.value)
    toast.success('已复制到剪贴板')
  } catch {
    toast.warning('复制失败，请手动全选复制')
  }
}

async function doImport(): Promise<void> {
  const text = importText.value.trim()
  if (!text) {
    toast.warning('请粘贴要导入的数据')
    return
  }
  let payload: PikpakGetExport
  try {
    payload = JSON.parse(text) as PikpakGetExport
  } catch {
    toast.error('导入数据不是合法的 JSON')
    return
  }
  if (!payload.files || typeof payload.files !== 'object') {
    toast.error('导入数据缺少 files 字段')
    return
  }
  busyImport.value = true
  try {
    const count = await store.importData(payload)
    toast.success(`已导入 ${count} 个数据文件${payload.masterKey ? '，主密钥已更新' : ''}`)
    importOpen.value = false
    importText.value = ''
  } catch (error) {
    toast.error((error as Error).message || '导入失败')
  } finally {
    busyImport.value = false
  }
}

async function login(): Promise<void> {
  if (!loginLabel.value.trim() || !loginPassword.value) {
    toast.warning('请输入账号与密码')
    return
  }
  busyLogin.value = true
  try {
    await store.login(loginLabel.value.trim(), loginPassword.value)
    loginLabel.value = ''
    loginPassword.value = ''
    toast.success('登录成功')
  } catch (error) {
    toast.error((error as Error).message || '登录失败')
  } finally {
    busyLogin.value = false
  }
}

async function reveal(accountId: string): Promise<void> {
  try {
    revealed.value[accountId] = await store.revealPassword(accountId)
  } catch (error) {
    toast.error((error as Error).message || '读取密码失败')
  }
}

async function whoami(accountId: string): Promise<void> {
  whoamiBusy.value[accountId] = true
  try {
    await store.fetchWhoami(accountId)
  } catch (error) {
    toast.error((error as Error).message || '查询云盘用量失败')
  } finally {
    whoamiBusy.value[accountId] = false
  }
}

async function refreshOne(accountId: string): Promise<void> {
  try {
    await store.refreshAccount(accountId)
    toast.success('已续期')
  } catch (error) {
    toast.error((error as Error).message || '续期失败')
  }
}

async function removeAccount(accountId: string): Promise<void> {
  try {
    await store.logout(accountId)
    toast.success('已删除账号')
  } catch (error) {
    toast.error((error as Error).message || '删除失败')
  }
}

function trafficText(accountId: string): string {
  const item = store.accounts.find(account => account.id === accountId)
  const traffic = item?.traffic
  if (!traffic) return '未记录限流'
  if (traffic.remaining > 0) return `冷却中 ${Math.ceil(traffic.remaining / 60)} 分钟`
  return traffic.cappedAt ? '可重试' : '未记录限流'
}
</script>

<template>
  <div class="conn-accounts">
    <ToolFormSection title="引擎连接">
      <template #actions>
        <UiButton v-if="connected && !showConnectionForm" size="small" @click="openConnectionForm">
          配置
        </UiButton>
        <UiButton v-if="connected" size="small" @click="testConnection">
          测试
        </UiButton>
      </template>

      <div v-if="connected && !showConnectionForm" class="conn-summary">
        <span class="conn-mode">{{ connection?.mode === 'local' ? '本机' : 'NAS' }}</span>
        <span class="conn-url mono">{{ connection?.url }}</span>
      </div>

      <div v-if="connected && !showConnectionForm" class="migrate-row">
        <UiButton size="small" @click="doExport">
          导出
        </UiButton>
        <UiButton size="small" @click="importOpen = true">
          导入
        </UiButton>
        <span class="migrate-hint">本机 ↔ NAS 迁移账号与链接</span>
      </div>

      <div v-else class="conn-form">
        <div class="mode-switch">
          <UiButton size="small" :plain="mode !== 'local'" :type="mode === 'local' ? 'primary' : 'default'" @click="switchMode('local')">
            本机引擎
          </UiButton>
          <UiButton size="small" :plain="mode !== 'nas'" :type="mode === 'nas' ? 'primary' : 'default'" @click="switchMode('nas')">
            NAS 引擎
          </UiButton>
        </div>

        <template v-if="mode === 'local'">
          <p class="hint">
            本机模式在 app 内直接调用 TS 引擎，无需 Python / 子进程 / 依赖安装。
          </p>
          <div class="form-actions">
            <UiButton type="primary" @click="saveConnection">
              保存并启用本机引擎
            </UiButton>
          </div>
        </template>

        <template v-else>
          <UiFormField label="地址">
            <UiInput v-model="connectionUrl" input-type="url" placeholder="http://192.168.1.10:8787" />
          </UiFormField>
          <UiFormField label="Token">
            <UiInput v-model="connectionToken" input-type="password" placeholder="引擎 .env 里的 token" />
          </UiFormField>
          <div class="form-actions">
            <UiButton type="primary" @click="saveConnection">
              保存连接
            </UiButton>
          </div>
        </template>
      </div>
    </ToolFormSection>

    <ToolFormSection title="账号池" :divider="false">
      <template #actions>
        <span class="count-chip mono">{{ accounts.length }}</span>
      </template>

      <div v-if="connected" class="login-form">
        <UiInput v-model="loginLabel" placeholder="邮箱 / 手机号 / 用户名" />
        <UiInput v-model="loginPassword" input-type="password" placeholder="密码" />
        <UiButton type="primary" :disabled="busyLogin" @click="login">
          添加 / 登录账号
        </UiButton>
      </div>

      <div v-if="!accounts.length" class="empty-block">
        <UiEmpty text="尚未添加账号" />
      </div>

      <div v-else class="account-list">
        <div v-for="account in accounts" :key="account.id" class="account-row">
          <div class="account-main">
            <div class="account-label">
              {{ account.label }}
            </div>
            <div class="account-meta mono">
              {{ trafficText(account.id) }}
            </div>
            <div v-if="whoamiMap[account.id]" class="account-quota mono">
              {{ humanPikpakBytes(whoamiMap[account.id].usage) }} / {{ humanPikpakBytes(whoamiMap[account.id].limit) }}
            </div>
          </div>
          <div class="account-actions">
            <UiIconButton icon="info" label="云盘用量" @click="whoami(account.id)" />
            <UiIconButton icon="copy" label="查看密码" @click="reveal(account.id)" />
            <UiIconButton icon="refresh" label="续期" @click="refreshOne(account.id)" />
            <UiIconButton icon="trash" label="删除账号" @click="removeAccount(account.id)" />
          </div>
          <div v-if="revealed[account.id]" class="revealed">
            <code>{{ revealed[account.id] }}</code>
          </div>
        </div>
      </div>
    </ToolFormSection>

    <UiDialog v-model="exportOpen" title="导出引擎数据" width="560px">
      <div class="dialog-body">
        <p class="dialog-warn">
          导出内容包含账号密码密文、会话令牌与主密钥，等于本引擎全部账号的访问权。请妥善保管，不要外传。
        </p>
        <textarea v-model="exportText" class="export-text" readonly spellcheck="false" />
      </div>
      <template #footer>
        <UiButton @click="exportOpen = false">
          关闭
        </UiButton>
        <UiButton type="primary" @click="copyExport">
          复制到剪贴板
        </UiButton>
      </template>
    </UiDialog>

    <UiDialog v-model="importOpen" title="导入引擎数据" width="560px">
      <div class="dialog-body">
        <p class="dialog-warn">
          导入会覆盖当前引擎的账号库与链接库，并更新主密钥。确认后再执行。
        </p>
        <textarea v-model="importText" class="export-text" placeholder="粘贴导出数据（JSON）" spellcheck="false" />
      </div>
      <template #footer>
        <UiButton @click="importOpen = false">
          取消
        </UiButton>
        <UiButton type="primary" :disabled="busyImport" @click="doImport">
          导入
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped lang="scss">
.conn-accounts {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}

.conn-summary {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
}

.conn-mode {
  flex: none;
  color: var(--color-primary-strong);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.conn-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.migrate-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.migrate-hint {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.dialog-warn {
  color: var(--color-warning);
  font-size: var(--font-size-xs);
  line-height: 1.5;
}

.export-text {
  width: 100%;
  min-height: 220px;
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-field);
  color: var(--color-text-primary);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  resize: vertical;
}

.conn-form,
.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.form-actions {
  display: flex;
  gap: var(--spacing-sm);
}

.hint {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  line-height: 1.5;
}

.mode-switch {
  display: flex;
  gap: var(--spacing-sm);
}

.count-chip {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.empty-block {
  padding: var(--spacing-sm) 0;
}

.account-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.account-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  background: var(--color-table);
}

.account-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.account-label {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}

.account-meta,
.account-quota {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
}

.account-actions {
  display: flex;
  flex: none;
  gap: 2px;
}

.revealed {
  margin-top: var(--spacing-xs);
  padding: var(--spacing-sm);
  background: var(--color-fill);
  border-radius: var(--radius-sm);
  word-break: break-all;
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
}
</style>
