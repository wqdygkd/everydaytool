<script setup lang="ts">
import { toast } from 'vue-sonner'
import { useCopy } from '../../../../renderer/shared/composables/useClipboard'
import { INTERCEPTOR_PROXY_PORT_MAX, INTERCEPTOR_PROXY_PORT_MIN } from '../../../../shared/interceptor'
import { useInterceptorStore } from '../stores/interceptorStore'

const store = useInterceptorStore()

const connections = computed(() => store.status?.connections ?? [])
const proxyEnabled = computed(() => connections.value.some(connection => connection.proxyEnabled))
const proxyEndpoint = computed(() => (store.status?.proxyPort ? `127.0.0.1:${store.status.proxyPort}` : ''))

const caState = computed(() => store.ca?.trustState ?? 'not-found')
const caBusy = ref(false)

const caLabel = computed(() => {
  if (!store.ca || !store.ca.generated) return '未生成'
  switch (store.ca.trustState) {
    case 'trusted': return '已安装并被信任'
    case 'installed': return '已安装'
    case 'installed-untrusted': return '已安装但未受信任'
    case 'error': return '检查出错'
    default: return '未安装'
  }
})

const caTagType = computed<'success' | 'warning' | 'danger' | 'info'>(() => {
  if (caState.value === 'trusted') return 'success'
  if (caState.value === 'error') return 'danger'
  if (caState.value === 'installed' || caState.value === 'installed-untrusted') return 'warning'
  return 'info'
})

async function installCertificate(): Promise<void> {
  caBusy.value = true
  try {
    const result = await store.installCa()
    if (result.ok) toast.success('已安装到系统信任库，重启浏览器后生效')
    else toast.error(result.detail ?? '安装失败')
  } finally {
    caBusy.value = false
  }
}

async function uninstallCertificate(): Promise<void> {
  caBusy.value = true
  try {
    const result = await store.uninstallCa()
    if (result.ok) toast.success('已从系统信任库移除')
    else toast.error(result.detail ?? '卸载失败')
  } finally {
    caBusy.value = false
  }
}

async function exportCertificate(): Promise<void> {
  const saved = await store.exportCa()
  if (saved) toast.success(`已导出：${saved}`)
}

async function refreshCertificate(): Promise<void> {
  caBusy.value = true
  try {
    await store.refreshCa(true)
  } finally {
    caBusy.value = false
  }
}

const portDialogVisible = ref(false)
const portDraft = ref('')
const portSaving = ref(false)

function openPortDialog(): void {
  portDraft.value = store.status?.proxyPort ? String(store.status.proxyPort) : ''
  portDialogVisible.value = true
}

async function submitPort(): Promise<void> {
  const port = Number(portDraft.value.trim())
  if (!Number.isInteger(port) || port < INTERCEPTOR_PROXY_PORT_MIN || port > INTERCEPTOR_PROXY_PORT_MAX) {
    toast.warning(`端口需在 ${INTERCEPTOR_PROXY_PORT_MIN}–${INTERCEPTOR_PROXY_PORT_MAX} 之间`)
    return
  }
  portSaving.value = true
  const result = await store.setProxyPort(port)
  portSaving.value = false
  if (!result.ok) {
    toast.error(result.error ?? '修改端口失败')
    return
  }
  portDialogVisible.value = false
  toast.success(`代理端口已改为 ${port}`)
}

async function openExtensionDir(): Promise<void> {
  const ok = await store.openExtensionDir()
  if (!ok) toast.error('打开扩展目录失败')
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString()
}
</script>

<template>
  <div class="status-board">
    <section class="status-main">
      <div class="summary-row">
        <div class="summary-state">
          <span class="live-dot" :class="{ 'is-running': store.status?.proxyRunning }" />
          <div>
            <strong>{{ store.status?.proxyRunning ? '代理运行中' : '代理未运行' }}</strong>
            <span>{{ proxyEndpoint || '等待浏览器扩展连接' }}</span>
          </div>
        </div>
      </div>

      <div class="metric-grid">
        <div class="metric">
          <span>代理端口</span>
          <div>
            <strong class="mono">{{ store.status?.proxyPort ?? '—' }}</strong>
            <UiIconButton
              icon="copy"
              :size="26"
              label="复制代理地址"
              :disabled="!proxyEndpoint"
              @click="useCopy(proxyEndpoint, '代理地址')"
            />
            <UiButton size="small" text type="primary" @click="openPortDialog">
              修改
            </UiButton>
          </div>
        </div>
        <div class="metric">
          <span>控制端口</span>
          <div>
            <strong class="mono">{{ store.status?.wsPort ?? '—' }}</strong>
            <span class="metric-note">扩展自动探测</span>
          </div>
        </div>
        <div class="metric">
          <span>已连接浏览器</span>
          <div>
            <strong>{{ connections.length }}</strong>
            <span class="metric-note">{{ proxyEnabled ? '代理已挂载' : '直连中' }}</span>
          </div>
        </div>
      </div>

      <div v-if="store.status?.proxyPortNote" class="inline-note">
        {{ store.status.proxyPortNote }}
      </div>

      <div class="connection-list">
        <div class="section-label">
          浏览器连接
        </div>
        <div v-if="connections.length === 0" class="connection-empty">
          还没有扩展连入。按右侧步骤加载扩展后，这里会出现连接。
        </div>
        <div v-for="connection in connections" :key="connection.clientId" class="connection-row">
          <span class="connection-app">{{ connection.appId }}</span>
          <span class="mono connection-id">#{{ connection.clientId.slice(0, 8) }}</span>
          <UiChip :tone="connection.proxyEnabled ? 'success' : 'warning'" variant="soft">
            {{ connection.proxyEnabled ? '代理已挂载' : '未挂载' }}
          </UiChip>
          <span class="connection-time">{{ formatTime(connection.connectedAt) }}</span>
          <span v-if="connection.proxyError" class="connection-error">{{ connection.proxyError }}</span>
        </div>
      </div>

      <p class="status-footnote">
        代理挂载由浏览器扩展控制；edt 断开时自动撤销（fail-open，不阻断日常上网）。
        「强制回源」在处理名单中逐条控制。
      </p>
    </section>

    <aside class="status-side">
      <section class="side-section">
        <div class="section-label">
          浏览器扩展接入
        </div>
        <ol class="steps">
          <li>打开 <span class="mono">chrome://extensions</span> 并启用开发者模式。</li>
          <li>加载已解压的扩展程序，选择下方目录。</li>
          <li>打开扩展图标，启用「挂载代理」。</li>
        </ol>
        <div class="path-row">
          <span class="mono path">{{ store.status?.extensionDir ?? '—' }}</span>
          <UiIconButton
            icon="copy"
            :size="27"
            label="复制扩展目录"
            @click="useCopy(store.status?.extensionDir ?? '', '路径')"
          />
          <UiIconButton icon="external" :size="27" label="打开扩展目录" @click="openExtensionDir" />
        </div>
      </section>

      <section class="side-section">
        <div class="section-head">
          <div class="section-label">
            HTTPS 根证书
          </div>
          <UiChip :tone="caTagType" variant="soft">
            {{ caLabel }}
          </UiChip>
        </div>
        <div class="detail-line">
          <span>证书名</span>
          <strong class="mono">{{ store.ca?.commonName || '—' }}</strong>
        </div>
        <div class="detail-line">
          <span>指纹</span>
          <strong class="mono fingerprint">{{ store.ca?.fingerprint || '—' }}</strong>
        </div>
        <div v-if="store.ca?.detail" class="inline-note">
          {{ store.ca.detail }}
        </div>
        <div class="cert-actions">
          <UiButton
            size="small"
            type="primary"
            :loading="caBusy"
            :disabled="store.ca?.platform === 'unsupported'"
            @click="installCertificate"
          >
            安装信任
          </UiButton>
          <UiButton size="small" @click="exportCertificate">
            导出 .crt
          </UiButton>
          <UiButton size="small" text :loading="caBusy" @click="refreshCertificate">
            刷新
          </UiButton>
          <UiButton
            size="small"
            text
            type="danger"
            :disabled="!store.ca?.generated || caState === 'not-found'"
            @click="uninstallCertificate"
          >
            卸载
          </UiButton>
        </div>
        <p class="side-footnote">
          只有处理名单内的 HTTPS 才需要证书；安装后重启浏览器生效。
        </p>
      </section>
    </aside>

    <UiDialog v-model="portDialogVisible" title="修改代理端口" width="440px">
      <div class="port-form" @submit.prevent>
        <UiFormField label-width="80px" label="代理端口">
          <UiInput
            v-model="portDraft"
            :placeholder="`${INTERCEPTOR_PROXY_PORT_MIN} - ${INTERCEPTOR_PROXY_PORT_MAX}`"
          />
        </UiFormField>
      </div>
      <UiHint block>
        改端口会重启代理；正在进行的请求会中断，已连接的浏览器会自动改用新端口。
      </UiHint>
      <template #footer>
        <UiButton @click="portDialogVisible = false">
          取消
        </UiButton>
        <UiButton type="primary" :loading="portSaving" @click="submitPort">
          保存
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped lang="scss">
.status-board {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.status-main,
.status-side {
  min-height: 0;
  overflow-y: auto;
}

.status-main {
  padding: 20px;
}

.status-side {
  border-left: 1px solid var(--color-border-light);
  background: var(--color-well);
}

.summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-lg);
}

.summary-state {
  display: flex;
  align-items: center;
  gap: 11px;

  > div {
    display: grid;
    gap: 2px;
  }

  strong {
    font-size: var(--font-size-base);
    font-weight: var(--font-weight-medium);
  }

  span {
    color: var(--color-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
  }
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-text-tertiary) 12%, transparent);

  &.is-running {
    background: var(--color-success);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-success) 13%, transparent);
  }
}

.summary-actions,
.cert-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  margin-top: 20px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-border-light);
}

.metric {
  min-width: 0;
  padding: 12px 13px;
  background: var(--color-well);

  > span {
    color: var(--color-text-secondary);
    font-size: var(--font-size-xs);
  }

  > div {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 28px;
    margin-top: 4px;
  }

  strong {
    font-size: var(--font-size-lg);
    font-weight: var(--font-weight-medium);
  }
}

.metric-note {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.inline-note {
  margin-top: 12px;
  padding: 9px 11px;
  border-left: 1px solid var(--color-warning);
  background: color-mix(in srgb, var(--color-warning) 7%, transparent);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: 1.55;
}

.connection-list {
  margin-top: 22px;
}

.section-label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.connection-empty {
  padding: 18px 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
}

.connection-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 44px;
  border-bottom: 1px solid var(--color-border-light);
  font-size: var(--font-size-xs);
}

.connection-app {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
}

.connection-id,
.connection-time,
.connection-error {
  color: var(--color-text-tertiary);
}

.connection-time {
  margin-left: auto;
}

.connection-error {
  color: var(--color-error);
}

.status-footnote,
.side-footnote {
  margin: 16px 0 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  line-height: 1.55;
}

.side-section {
  padding: 17px 16px;

  & + & {
    border-top: 1px solid var(--color-border-light);
  }
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}

.steps {
  margin: 10px 0;
  padding-left: 17px;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: 1.65;
}

.path-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-top: 9px;
  border-top: 1px solid var(--color-border-light);
}

.path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-line {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 8px;
  padding: 6px 0;
  font-size: var(--font-size-xs);

  span {
    color: var(--color-text-tertiary);
  }

  strong {
    overflow: hidden;
    color: var(--color-text-secondary);
    font-weight: var(--font-weight-regular);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.fingerprint {
  font-size: 10px;
}

.cert-actions {
  flex-wrap: wrap;
  margin-top: 12px;
}

@media (max-width: 1180px) {
  .status-board {
    grid-template-columns: minmax(0, 1fr) 320px;
  }
}
</style>
