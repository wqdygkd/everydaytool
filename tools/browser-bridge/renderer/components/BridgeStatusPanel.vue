<script setup lang="ts">
import { useBrowserBridgeStore } from '../stores/browserBridgeStore'

const store = useBrowserBridgeStore()

const connections = computed(() => store.status?.connections ?? [])
const proxyEnabled = computed(() => connections.value.some(connection => connection.proxyEnabled))

async function copyText(text: string, label: string): Promise<void> {
  if (!text) return
  await navigator.clipboard.writeText(text)
  ElMessage.success(`${label}已复制`)
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
    <div class="surface-card panel">
      <div class="panel-title">
        运行状态
        <el-tag :type="store.status?.proxyRunning ? 'success' : 'info'" size="small">
          {{ store.status?.proxyRunning ? '代理运行中' : '未运行' }}
        </el-tag>
      </div>
      <div class="kv-row">
        <span class="kv-label">代理端口</span>
        <span class="kv-value mono">{{ store.status?.proxyPort ?? '—' }}</span>
      </div>
      <div class="kv-row">
        <span class="kv-label">桥通道端口</span>
        <span class="kv-value mono">{{ store.status?.wsPort ?? '—' }}</span>
      </div>
      <div class="kv-row">
        <span class="kv-label">已连接浏览器</span>
        <span class="kv-value">{{ connections.length }}</span>
      </div>

      <div v-for="connection in connections" :key="connection.clientId" class="connection-item">
        <div class="inline-group">
          <el-tag size="small">
            {{ connection.appId }}
          </el-tag>
          <span class="mono muted">#{{ connection.clientId.slice(0, 8) }}</span>
          <el-tag :type="connection.proxyEnabled ? 'success' : 'warning'" size="small">
            {{ connection.proxyEnabled ? '代理已挂载' : '未挂载' }}
          </el-tag>
        </div>
        <div class="form-hint">
          连接于 {{ formatTime(connection.connectedAt) }}
          <template v-if="connection.proxyError">
            · {{ connection.proxyError }}
          </template>
        </div>
      </div>

      <div class="inline-group actions">
        <el-button size="small" :disabled="!connections.length" @click="applyDesired(true)">
          让浏览器挂载代理
        </el-button>
        <el-button size="small" :disabled="!connections.length || !proxyEnabled" @click="applyDesired(false)">
          恢复直连
        </el-button>
      </div>
      <p class="form-hint">
        代理挂载由浏览器扩展控制；edt 断开时代理会自动撤销（fail-open，不阻断日常上网）。
      </p>
    </div>

    <div class="surface-card panel">
      <div class="panel-title">
        浏览器扩展接入
      </div>
      <ol class="steps">
        <li>在 Chrome 打开 <span class="mono">chrome://extensions</span>，开启右上角「开发者模式」。</li>
        <li>点「加载已解压的扩展程序」，选择下面的扩展目录。</li>
        <li>复制配对码，填入扩展弹窗的输入框并保存。</li>
      </ol>
      <div class="kv-row">
        <span class="kv-label">配对码</span>
        <span class="kv-value inline-group">
          <span class="mono token">{{ store.status?.token || '—' }}</span>
          <el-button size="small" text type="primary" @click="copyText(store.status?.token ?? '', '配对码')">
            复制
          </el-button>
        </span>
      </div>
      <div class="kv-row">
        <span class="kv-label">扩展目录</span>
        <span class="kv-value inline-group path-cell">
          <span class="mono path">{{ store.status?.extensionDir ?? '—' }}</span>
          <el-button size="small" text type="primary" @click="copyText(store.status?.extensionDir ?? '', '路径')">
            复制
          </el-button>
          <el-button size="small" text type="primary" @click="openExtensionDir">打开</el-button>
        </span>
      </div>
      <p class="form-hint">
        扩展只放通用原语（代理开关 / 桥 / 脚本注入）；规则、mock、日志全部在 edt 侧，扩展日常无需更新。
      </p>
    </div>
  </div>
</template>

<style scoped>
.bridge-panels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: var(--spacing-lg);
}

.panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-sm);
  font-weight: var(--font-weight-semibold);
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
  padding-left: 18px;
  color: var(--color-text-secondary);
  line-height: 1.7;
}

.token {
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: all;
}

.path-cell {
  max-width: 100%;
  overflow: hidden;
}

.path {
  overflow: hidden;
  font-size: var(--font-size-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
