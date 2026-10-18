<script setup lang="ts">
import { useCopy } from '../../../../renderer/shared/composables/useClipboard'
import { useInterceptorStore } from '../stores/interceptorStore'

const store = useInterceptorStore()

const connections = computed(() => store.status?.connections ?? [])
const proxyEnabled = computed(() => connections.value.some(connection => connection.proxyEnabled))

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
        <el-tag :type="store.status?.proxyRunning ? 'success' : 'info'" size="small">
          {{ store.status?.proxyRunning ? '代理运行中' : '未运行' }}
        </el-tag>
      </template>
      <UiKeyValue label="代理端口" mono>
        {{ store.status?.proxyPort ?? '—' }}
      </UiKeyValue>
      <UiKeyValue label="WS 端口" mono>
        {{ store.status?.wsPort ?? '—' }}
      </UiKeyValue>
      <UiKeyValue label="已连接浏览器">
        {{ connections.length }}
      </UiKeyValue>

      <div v-for="connection in connections" :key="connection.clientId" class="connection-item">
        <UiGroup gap="sm">
          <el-tag size="small">
            {{ connection.appId }}
          </el-tag>
          <span class="mono muted">#{{ connection.clientId.slice(0, 8) }}</span>
          <el-tag :type="connection.proxyEnabled ? 'success' : 'warning'" size="small">
            {{ connection.proxyEnabled ? '代理已挂载' : '未挂载' }}
          </el-tag>
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
        <li>复制配对码，填入扩展弹窗的输入框并保存。</li>
      </ol>
      <UiKeyValue label="配对码">
        <span class="mono token">{{ store.status?.token || '—' }}</span>
        <template #actions>
          <el-button size="small" text type="primary" @click="useCopy(store.status?.token ?? '', '配对码')">
            复制
          </el-button>
        </template>
      </UiKeyValue>
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
        扩展只放通用原语（代理开关 / 控制通道 / 脚本注入）；规则、mock、日志全部在 edt 侧，扩展日常无需更新。
      </UiHint>
    </UiPanel>
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
  line-height: 1.7;
}

.token {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: all;
}

.path {
  display: block;
  overflow: hidden;
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
