<script setup lang="ts">
import type {
  Wb2apiPanelState,
  Wb2apiProgressEvent,
  Wb2apiUpdateInfo,
} from '../../../../shared/workbuddy2api-panel'
import { registerTabCloseGuard } from '@renderer/shared/composables/useTabCloseGuard'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { ElMessage, ElMessageBox } from 'element-plus'
import { WB2API_WEBVIEW_PARTITION } from '../../../../shared/webview'
import {
  buildWb2apiAnthropicBaseUrl,
  buildWb2apiOpenAiBaseUrl,
  buildWb2apiPanelUrl,
  WB2API_DEFAULT_PORT,
  WB2API_GITHUB_REPO_SLUG,
  WB2API_TOOL_ID,
  wb2apiStatusLabel,
} from '../../../../shared/workbuddy2api-panel'
import { invokeWb2apiIpc, onWb2apiIpc, wb2apiIpcChannels } from '../ipc'

const upstreamRepoUrl = `https://github.com/${WB2API_GITHUB_REPO_SLUG}`

function openUpstreamRepo() {
  openExternal(upstreamRepoUrl)
}

const state = ref<Wb2apiPanelState | null>(null)
const loading = ref(false)
const progress = ref<Wb2apiProgressEvent | null>(null)
const updateInfo = ref<Wb2apiUpdateInfo | null>(null)
const apiKeyVisible = ref(false)

const apiKeyDisplay = computed(() => {
  const key = state.value?.apiKey
  if (!key) return '—'
  return apiKeyVisible.value ? key : '••••••••••••'
})

const channels = computed(() => {
  try {
    return wb2apiIpcChannels()
  } catch {
    return null
  }
})

const status = computed(() => state.value?.status ?? 'not_installed')
const isRunning = computed(() =>
  status.value === 'running'
  || status.value === 'running_empty'
  || status.value === 'unhealthy',
)
const showWebview = computed(() =>
  status.value === 'running' || status.value === 'running_empty',
)
const panelSrc = computed(() => state.value?.panelUrl ?? '')
const endpointPort = computed(() => state.value?.port ?? WB2API_DEFAULT_PORT)
const openAiBaseUrl = computed(() => buildWb2apiOpenAiBaseUrl(endpointPort.value))
const anthropicBaseUrl = computed(() => buildWb2apiAnthropicBaseUrl(endpointPort.value))
const panelUrl = computed(() => state.value?.panelUrl ?? buildWb2apiPanelUrl(endpointPort.value))
const statusTone = computed<'neutral' | 'success' | 'warning' | 'danger'>(() => {
  switch (status.value) {
    case 'running': return 'success'
    case 'running_empty':
    case 'updating': return 'warning'
    case 'unhealthy':
    case 'error': return 'danger'
    default: return 'neutral'
  }
})

function applyState(next: Wb2apiPanelState) {
  state.value = next
  if (next.progress) progress.value = next.progress
}

async function refresh() {
  try {
    const next = await invokeWb2apiIpc(channels.value!.GET_STATE) as Wb2apiPanelState
    applyState(next)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  }
}

async function runAction(action: () => Promise<unknown>, okMsg?: string) {
  loading.value = true
  try {
    const next = await action()
    if (next && typeof next === 'object' && 'status' in (next as object)) {
      applyState(next as Wb2apiPanelState)
    } else {
      await refresh()
    }
    if (okMsg) ElMessage.success(okMsg)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
    await refresh().catch(() => {})
  } finally {
    loading.value = false
  }
}

function onInstallGithub() {
  return runAction(() => invokeWb2apiIpc(channels.value!.INSTALL), '安装完成，可点击启动')
}

function onInstallZip() {
  return runAction(() => invokeWb2apiIpc(channels.value!.INSTALL_FROM_ZIP), '安装完成，可点击启动')
}

function onCancelDownload() {
  return runAction(() => invokeWb2apiIpc(channels.value!.CANCEL_DOWNLOAD), '已取消下载')
}

function onStart() {
  return runAction(() => invokeWb2apiIpc(channels.value!.START), '已启动')
}

function onStop() {
  return runAction(() => invokeWb2apiIpc(channels.value!.STOP), '已停止')
}

function onRestart() {
  return runAction(() => invokeWb2apiIpc(channels.value!.RESTART), '已重启')
}

function onKillOrphan() {
  return runAction(() => invokeWb2apiIpc(channels.value!.KILL_ORPHAN), '已结束占用进程')
}

function onOpenDataDir() {
  return runAction(() => invokeWb2apiIpc(channels.value!.OPEN_DATA_DIR))
}

async function onCheckUpdate() {
  loading.value = true
  try {
    updateInfo.value = await invokeWb2apiIpc(channels.value!.CHECK_UPDATE) as Wb2apiUpdateInfo
    if (!updateInfo.value.hasUpdate) ElMessage.success('已是最新版本')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}

async function onApplyUpdate() {
  if (!updateInfo.value?.hasUpdate) {
    await onCheckUpdate()
    if (!updateInfo.value?.hasUpdate) return
  }
  try {
    await ElMessageBox.confirm(
      `将更新到 ${updateInfo.value.latestTag}（${updateInfo.value.assetName}）。失败会回滚 previous。`,
      '确认更新',
      { confirmButtonText: '更新', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  return runAction(() => invokeWb2apiIpc(channels.value!.APPLY_UPDATE), '更新完成')
}

const progressText = computed(() => {
  const p = progress.value
  if (!p) return ''
  if (p.phase === 'download' && p.totalBytes > 0) {
    const pct = Math.min(100, Math.round((p.downloadedBytes / p.totalBytes) * 100))
    return `${p.message ?? '下载中'} ${pct}%`
  }
  return p.message || p.error || p.phase
})

let offState: (() => void) | null = null
let offProgress: (() => void) | null = null
let unguard: (() => void) | null = null

onMounted(() => {
  if (!channels.value) return
  void refresh()
  offState = onWb2apiIpc(channels.value.EVENT_STATE, (payload) => {
    applyState(payload as Wb2apiPanelState)
  })
  offProgress = onWb2apiIpc(channels.value.EVENT_PROGRESS, (payload) => {
    progress.value = payload as Wb2apiProgressEvent
  })

  // 关页签 = 停服务（可短确认）
  unguard = registerTabCloseGuard(WB2API_TOOL_ID, async () => {
    try {
      const current = await invokeWb2apiIpc(channels.value!.GET_STATE) as Wb2apiPanelState
      const running = current.status === 'running'
        || current.status === 'running_empty'
        || current.status === 'unhealthy'
        || current.status === 'updating'
      if (!running) return true
      try {
        await ElMessageBox.confirm('关闭将停止服务', '关闭页签', {
          confirmButtonText: '停止并关闭',
          cancelButtonText: '取消',
          type: 'warning',
        })
      } catch {
        return false
      }
      await invokeWb2apiIpc(channels.value!.STOP)
      return true
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : String(error))
      return false
    }
  })
})

onUnmounted(() => {
  offState?.()
  offProgress?.()
  unguard?.()
})
</script>

<template>
  <div class="tool-page wb2api-page">
    <div class="wb2api-layout">
      <section class="wb2api-main">
        <webview
          v-if="showWebview && panelSrc"
          class="wb2api-webview"
          :src="panelSrc"
          :partition="WB2API_WEBVIEW_PARTITION"
          allowpopups
        />
        <UiEmpty
          v-else
          class="wb2api-empty"
          center
          icon="wb2api"
          :text="status === 'not_installed'
            ? '尚未安装上游二进制，请在右侧从 GitHub 或本地 ZIP 安装'
            : '服务未运行。安装完成后点击「启动」，面板将显示在此处'"
        />
      </section>

      <aside class="wb2api-ops">
        <UiPanel title="启停" padding="var(--spacing-md)">
          <div class="wb2api-actions">
            <el-button
              type="primary"
              :disabled="loading || !state?.installed || isRunning"
              @click="onStart"
            >
              启动
            </el-button>
            <el-button :disabled="loading || !isRunning" @click="onStop">
              停止
            </el-button>
            <el-button :disabled="loading || !state?.installed" @click="onRestart">
              重启
            </el-button>
          </div>
          <UiHint v-if="state?.orphanLikely" class="wb2api-hint">
            检测到端口被其它进程占用（非本工具托管）。可结束占用，不会接管该进程。
          </UiHint>
          <el-button
            v-if="state?.orphanLikely"
            class="full-width"
            size="small"
            type="warning"
            :disabled="loading"
            @click="onKillOrphan"
          >
            结束占用
          </el-button>
        </UiPanel>

        <UiPanel title="状态" padding="var(--spacing-md)">
          <template #actions>
            <el-button size="small" text :disabled="loading" @click="refresh">
              刷新
            </el-button>
          </template>
          <div class="wb2api-status-row">
            <UiStatusTag :tone="statusTone" :pulsing="status === 'running'" />
            <span class="wb2api-status-label">{{ wb2apiStatusLabel(status) }}</span>
          </div>
          <UiKeyValue label="版本" mono label-width="72px">
            {{ state?.version ?? '—' }}
          </UiKeyValue>
          <UiKeyValue class="wb2api-kv-inline" label="OpenAI" mono label-width="72px">
            <span class="wb2api-endpoint" :title="openAiBaseUrl">{{ openAiBaseUrl }}</span>
            <template #actions>
              <UiCopyButton :text="openAiBaseUrl" label="OpenAI Base URL" />
            </template>
          </UiKeyValue>
          <UiKeyValue class="wb2api-kv-inline" label="Anthropic" mono label-width="72px">
            <span class="wb2api-endpoint" :title="anthropicBaseUrl">{{ anthropicBaseUrl }}</span>
            <template #actions>
              <UiCopyButton :text="anthropicBaseUrl" label="Anthropic Base URL" />
            </template>
          </UiKeyValue>
          <UiKeyValue class="wb2api-kv-inline" label="面板" mono label-width="72px">
            <span class="wb2api-endpoint" :title="panelUrl">{{ panelUrl }}</span>
            <template #actions>
              <UiCopyButton :text="panelUrl" label="面板地址" />
            </template>
          </UiKeyValue>
          <UiKeyValue class="wb2api-kv-inline" label="API Key" mono label-width="72px">
            <span class="wb2api-api-key" :title="apiKeyVisible ? (state?.apiKey ?? '') : ''">{{ apiKeyDisplay }}</span>
            <template v-if="state?.apiKey" #actions>
              <el-button size="small" text @click="apiKeyVisible = !apiKeyVisible">
                {{ apiKeyVisible ? '隐藏' : '显示' }}
              </el-button>
              <UiCopyButton :text="state.apiKey" label="API Key" />
            </template>
          </UiKeyValue>
        </UiPanel>

        <UiPanel title="安装 / 更新" padding="var(--spacing-md)">
          <div class="wb2api-actions">
            <el-button :disabled="loading || state?.updating" @click="onInstallGithub">
              GitHub 安装
            </el-button>
            <el-button :disabled="loading || state?.updating" @click="onInstallZip">
              本地 ZIP
            </el-button>
          </div>
          <div class="wb2api-actions">
            <el-button size="small" :disabled="loading" @click="onCheckUpdate">
              检查更新
            </el-button>
            <el-button
              size="small"
              type="primary"
              plain
              :disabled="loading || !updateInfo?.hasUpdate"
              @click="onApplyUpdate"
            >
              应用更新
            </el-button>
            <el-button
              v-if="state?.updating"
              size="small"
              :disabled="loading"
              @click="onCancelDownload"
            >
              取消下载
            </el-button>
          </div>
          <UiHint v-if="updateInfo" class="wb2api-hint">
            当前 {{ updateInfo.currentVersion ?? '未安装' }}
            → 最新 {{ updateInfo.latestTag }}
            <span v-if="updateInfo.hasUpdate">（可更新）</span>
            <span v-else>（已最新）</span>
          </UiHint>
          <UiHint v-if="progressText" class="wb2api-hint">
            {{ progressText }}
          </UiHint>
          <el-button class="full-width" size="small" text @click="onOpenDataDir">
            打开数据目录
          </el-button>
        </UiPanel>

        <UiPanel title="说明" padding="var(--spacing-md)">
          <UiHint block>
            本地托管上游
            <a class="wb2api-link" :href="upstreamRepoUrl" @click.prevent="openUpstreamRepo">workbuddy2api-panel</a>。
            二进制不随 edt 安装包分发，需从 GitHub 或本地 ZIP 装到数据目录；打开页签不会自动启动，关闭页签会停止服务。
            启动时强制只监听 127.0.0.1 并关闭上游自更新；账号与配置在本机 run/，换版本不丢。
          </UiHint>
        </UiPanel>

        <UiPanel v-if="state?.lastError" title="最近错误" padding="var(--spacing-md)">
          <p class="wb2api-error mono">
            {{ state.lastError }}
          </p>
        </UiPanel>
      </aside>
    </div>
  </div>
</template>

<style scoped lang="scss">
.wb2api-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: var(--spacing-md);
  box-sizing: border-box;
}

.wb2api-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: var(--spacing-md);
}

.wb2api-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-raised);
  backdrop-filter: var(--glass-raised);
}

.wb2api-webview {
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  border: 0;
}

.wb2api-empty {
  flex: 1;
  justify-content: center;
}

.wb2api-ops {
  width: 380px;
  flex-shrink: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.wb2api-status-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.wb2api-status-label {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
}

.wb2api-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
}

.wb2api-hint {
  margin-bottom: var(--spacing-sm);
}

.wb2api-kv-inline {
  :deep(.ui-kv-value) {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.wb2api-api-key,
.wb2api-endpoint {
  display: inline;
}

.wb2api-link {
  color: var(--color-primary);
  text-decoration: none;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.wb2api-error {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-error);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
