<script setup lang="ts">
import { useCopy } from '../../../../renderer/shared/composables/useClipboard'
import { INTERCEPTOR_PROXY_PORT_MAX, INTERCEPTOR_PROXY_PORT_MIN } from '../../../../shared/interceptor'
import { useInterceptorStore } from '../stores/interceptorStore'

const store = useInterceptorStore()

const connections = computed(() => store.status?.connections ?? [])
const proxyEnabled = computed(() => connections.value.some(connection => connection.proxyEnabled))
const proxyEndpoint = computed(() => (store.status?.proxyPort ? `127.0.0.1:${store.status.proxyPort}` : ''))

// ---------------------------------------------------------------------------
// HTTPS 根证书（解密名单内 HTTPS 的前提）
// ---------------------------------------------------------------------------

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
    if (result.ok) ElMessage.success('已安装到系统信任库，重启浏览器后生效')
    else ElMessage.error(result.detail ?? '安装失败')
  } finally {
    caBusy.value = false
  }
}

async function uninstallCertificate(): Promise<void> {
  caBusy.value = true
  try {
    const result = await store.uninstallCa()
    if (result.ok) ElMessage.success('已从系统信任库移除')
    else ElMessage.error(result.detail ?? '卸载失败')
  } finally {
    caBusy.value = false
  }
}

async function exportCertificate(): Promise<void> {
  const saved = await store.exportCa()
  if (saved) ElMessage.success(`已导出：${saved}`)
}

async function refreshCertificate(): Promise<void> {
  caBusy.value = true
  try {
    await store.refreshCa(true)
  } finally {
    caBusy.value = false
  }
}

/** 代理端口修改弹窗 */
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
    ElMessage.warning(`端口需在 ${INTERCEPTOR_PROXY_PORT_MIN}–${INTERCEPTOR_PROXY_PORT_MAX} 之间`)
    return
  }
  portSaving.value = true
  const result = await store.setProxyPort(port)
  portSaving.value = false
  if (!result.ok) {
    ElMessage.error(result.error ?? '修改端口失败')
    return
  }
  portDialogVisible.value = false
  ElMessage.success(`代理端口已改为 ${port}`)
}

async function applyDesired(enabled: boolean): Promise<void> {
  const applied = await store.setProxyDesired(enabled)
  if (!applied) ElMessage.warning('没有已连接的浏览器（先在 Chrome 中打开扩展）')
  else ElMessage.success(enabled ? '已通知浏览器挂载代理' : '已通知浏览器恢复直连')
}

async function openExtensionDir(): Promise<void> {
  const ok = await store.openExtensionDir()
  if (!ok) ElMessage.error('打开扩展目录失败')
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString()
}
</script>

<template>
  <div class="bridge-panels">
    <UiPanel>
      <template #title>
        运行状态
      </template>
      <template #actions>
        <UiChip :tone="store.status?.proxyRunning ? 'success' : 'info'" variant="soft">
          {{ store.status?.proxyRunning ? '代理运行中' : '未运行' }}
        </UiChip>
      </template>
      <UiKeyValue label="代理端口" mono>
        {{ store.status?.proxyPort ?? '—' }}
        <template #actions>
          <el-button size="small" text type="primary" :disabled="!proxyEndpoint" @click="useCopy(proxyEndpoint, '代理地址')">
            复制地址
          </el-button>
          <el-button size="small" text type="primary" @click="openPortDialog">
            修改
          </el-button>
        </template>
      </UiKeyValue>
      <UiKeyValue label="控制端口">
        <span class="mono">{{ store.status?.wsPort ?? '—' }}</span>
        <span class="muted"> 扩展自动探测</span>
      </UiKeyValue>
      <UiKeyValue label="已连接浏览器">
        {{ connections.length }}
      </UiKeyValue>
      <el-alert
        v-if="store.status?.proxyPortNote"
        class="port-note"
        type="warning"
        :closable="false"
        show-icon
        :title="store.status.proxyPortNote"
      />
      <UiHint block>
        代理端口首次启动随机分配并固定，可随时修改（改了会自动通知已连接的浏览器重挂）；控制端口是扩展在本机固定端口段内自动探测的通道，无需填写。
      </UiHint>
      <UiHint block>
        「强制回源」按<strong>处理名单里的每条</strong>单独控制（默认开）：开了的 origin 响应去掉 <span class="mono">cache-control</span> /
        <span class="mono">etag</span> 等缓存头，浏览器每次都会真的发请求，流量页才看得到重复访问的资源。
      </UiHint>

      <div v-for="connection in connections" :key="connection.clientId" class="connection-item">
        <UiGroup gap="sm">
          <UiChip variant="outline">
            {{ connection.appId }}
          </UiChip>
          <span class="mono muted">#{{ connection.clientId.slice(0, 8) }}</span>
          <UiChip :tone="connection.proxyEnabled ? 'success' : 'warning'" variant="soft">
            {{ connection.proxyEnabled ? '代理已挂载' : '未挂载' }}
          </UiChip>
        </UiGroup>
        <UiHint block>
          连接于 {{ formatTime(connection.connectedAt) }}
          <template v-if="connection.proxyError">
            · {{ connection.proxyError }}
          </template>
        </UiHint>
      </div>

      <UiGroup class="actions" gap="sm">
        <el-button size="small" :disabled="!connections.length" @click="applyDesired(true)">
          让浏览器挂载代理
        </el-button>
        <el-button size="small" :disabled="!connections.length || !proxyEnabled" @click="applyDesired(false)">
          恢复直连
        </el-button>
      </UiGroup>
      <UiHint block>
        代理挂载由浏览器扩展控制；edt 断开时代理会自动撤销（fail-open，不阻断日常上网）。
      </UiHint>
    </UiPanel>

    <UiPanel title="浏览器扩展接入">
      <ol class="steps">
        <li>在 Chrome 打开 <span class="mono">chrome://extensions</span>，开启右上角「开发者模式」。</li>
        <li>点「加载已解压的扩展程序」，选择下面的扩展目录。</li>
        <li>点浏览器工具栏的扩展图标，打开「挂载代理」开关即可 —— <strong>无需配对码或任何配置</strong>。</li>
      </ol>
      <UiKeyValue label="扩展目录">
        <span class="mono path">{{ store.status?.extensionDir ?? '—' }}</span>
        <template #actions>
          <el-button size="small" text type="primary" @click="useCopy(store.status?.extensionDir ?? '', '路径')">
            复制
          </el-button>
          <el-button size="small" text type="primary" @click="openExtensionDir">
            打开
          </el-button>
        </template>
      </UiKeyValue>
      <UiHint block>
        扩展启动后自动连上 edt（来源校验通过即建立会话）；代理端口由 edt 下发。扩展只放通用原语（代理开关 / 控制通道 / 脚本注入），规则、mock、日志全部在 edt 侧。
      </UiHint>
    </UiPanel>

    <UiPanel title="HTTPS 根证书">
      <template #actions>
        <UiChip :tone="caTagType" variant="soft">
          {{ caLabel }}
        </UiChip>
      </template>
      <UiKeyValue label="证书名" mono>
        {{ store.ca?.commonName || '—' }}
      </UiKeyValue>
      <UiKeyValue label="指纹" mono>
        <span class="mono path">{{ store.ca?.fingerprint || '—' }}</span>
      </UiKeyValue>
      <el-alert
        v-if="store.ca?.detail"
        class="diag-alert"
        type="info"
        :closable="false"
        show-icon
        :title="store.ca.detail"
      />
      <UiHint block>
        只有解密名单内 HTTPS 才需要它：浏览器不信任这张根证书时，HTTPS 请求会在 TLS 握手阶段就失败，
        表现为「流量页空白 + 站点证书报错」。装到系统信任库对 Chrome / Edge 生效（装完重启浏览器）；
        Firefox 等自带证书库的浏览器请「导出 .crt」后手动导入。
      </UiHint>
      <UiGroup class="actions" gap="sm" wrap>
        <el-button
          size="small"
          type="primary"
          :loading="caBusy"
          :disabled="store.ca?.platform === 'unsupported'"
          @click="installCertificate"
        >
          安装到系统信任库
        </el-button>
        <el-button size="small" @click="exportCertificate">
          导出 .crt
        </el-button>
        <el-button size="small" text :loading="caBusy" @click="refreshCertificate">
          刷新状态
        </el-button>
        <el-button
          size="small"
          text
          type="danger"
          :disabled="!store.ca?.generated || caState === 'not-found'"
          @click="uninstallCertificate"
        >
          卸载
        </el-button>
      </UiGroup>
      <UiHint v-if="store.ca?.platform === 'unsupported'" block>
        当前平台不支持自动写入系统信任库，请用「导出 .crt」手动导入浏览器。
      </UiHint>
      <UiHint block>
        只有加入「处理名单」的站点才会出现在流量日志里，其它站点按透传处理（能上网但看不到正文）。
      </UiHint>
    </UiPanel>

    <UiDialog v-model="portDialogVisible" title="修改代理端口" width="440px">
      <el-form label-width="80px" @submit.prevent>
        <el-form-item label="代理端口">
          <el-input v-model="portDraft" :placeholder="`${INTERCEPTOR_PROXY_PORT_MIN} - ${INTERCEPTOR_PROXY_PORT_MAX}`" inputmode="numeric" />
        </el-form-item>
      </el-form>
      <UiHint block>
        改端口会重启代理，已挂载代理的浏览器会自动改用新端口；正在进行的请求会中断。
      </UiHint>
      <template #footer>
        <el-button @click="portDialogVisible = false">
          取消
        </el-button>
        <el-button type="primary" :loading="portSaving" @click="submitPort">
          保存
        </el-button>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped>
.bridge-panels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: var(--spacing-lg);
}

.connection-item {
  padding: var(--spacing-sm) 0;
  border-top: 1px solid var(--color-border-light);
}

.actions {
  margin-top: var(--spacing-sm);
}

.steps {
  margin: 0 0 var(--spacing-sm);
  padding-left: var(--spacing-xl);
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.port-note {
  margin-top: var(--spacing-sm);
}

.diag-alert {
  margin-top: var(--spacing-sm);
}

.path {
  display: block;
  overflow: hidden;
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
