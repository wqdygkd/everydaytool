<script setup lang="ts">
import type {
  Wb2apiPanelState,
  Wb2apiProgressEvent,
  Wb2apiUpdateInfo,
} from '../../../../shared/workbuddy2api-panel'
import { registerTabCloseGuard } from '@renderer/shared/composables/useTabCloseGuard'
import { confirm } from '@renderer/shared/feedback'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { toast } from 'vue-sonner'
import ToolSideInspector from '../../../../renderer/shared/components/workspace/ToolSideInspector.vue'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import WorkspaceHeader from '../../../../renderer/shared/components/workspace/WorkspaceHeader.vue'
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
const cancelling = ref(false)
/** 用户点了「取消下载」：由 abort 引发的中断不是失败，runAction 据此吞掉错误提示 */
const cancelRequested = ref(false)
const progress = ref<Wb2apiProgressEvent | null>(null)
const apiKeyVisible = ref(false)
const inspectorOpen = ref(false)
type InspectorTab = 'run' | 'install' | 'diagnostics'
const inspectorTab = ref<InspectorTab>('run')
const inspectorMenu = [
  { value: 'run', label: '运行' },
  { value: 'install', label: '安装' },
  { value: 'diagnostics', label: '诊断' },
]
const inspectorTitle = computed(() =>
  inspectorMenu.find(tab => tab.value === inspectorTab.value)?.label ?? '运行',
)

// 检查更新的结果缓存在主进程（state.update）：重开页签 / 刷新都在，渲染层不再自留一份副本。
// 已安装版本来自 manifest（state.version），与检查结果里的 currentVersion 同源现算。
const updateInfo = computed(() => state.value?.update ?? null)

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
const installed = computed(() => state.value?.installed === true)
/**
 * 是否有动作在飞：本地动作（loading）或后端安装 / 更新中（state.updating，例如别的窗口触发）。
 * 除「取消下载」外所有按钮都据此锁住——安装 / 更新会换 current 二进制并停服，
 * 期间再点启动 / 重启 / 再次安装只会互相打断，后端也只会回「已有任务进行中」。
 */
const busy = computed(() => loading.value || state.value?.updating === true)
/** 左栏空态文案：首次安装进行中时「尚未安装…请去安装」会自相矛盾，改说正在装 */
const emptyText = computed(() => {
  if (status.value === 'not_installed') {
    return state.value?.updating === true
      ? '正在安装上游二进制，完成后点击「启动」即可打开面板'
      : '尚未安装上游二进制，请在右侧从 GitHub 或本地 ZIP 安装'
  }
  return '服务未运行。安装完成后点击「启动」，面板将显示在此处'
})
const panelSrc = computed(() => state.value?.panelUrl ?? '')
const endpointPort = computed(() => state.value?.port ?? WB2API_DEFAULT_PORT)
const openAiBaseUrl = computed(() => buildWb2apiOpenAiBaseUrl(endpointPort.value))
const anthropicBaseUrl = computed(() => buildWb2apiAnthropicBaseUrl(endpointPort.value))
const panelUrl = computed(() => state.value?.panelUrl ?? buildWb2apiPanelUrl(endpointPort.value))
const statusTone = computed<'neutral' | 'success' | 'warning' | 'danger'>(() => {
  // 首次安装中 status 还是 not_installed（二进制尚未落盘），但语义是「进行中」：用 warning
  if (state.value?.updating === true && !installed.value) return 'warning'
  switch (status.value) {
    case 'running': return 'success'
    case 'running_empty':
    case 'updating': return 'warning'
    case 'unhealthy':
    case 'error': return 'danger'
    default: return 'neutral'
  }
})
/** 状态文案：首次安装期间标签改说「安装中」，别让「未安装」和安装进度同时出现 */
const statusLabel = computed(() =>
  state.value?.updating === true && !installed.value
    ? '安装中'
    : wb2apiStatusLabel(status.value),
)

function applyState(next: Wb2apiPanelState) {
  state.value = next
  if (next.progress) progress.value = next.progress
}

async function refresh() {
  try {
    const next = await invokeWb2apiIpc(channels.value!.GET_STATE) as Wb2apiPanelState
    applyState(next)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
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
    if (okMsg) toast.success(okMsg)
  } catch (error) {
    if (cancelRequested.value) {
      // 主动取消引发的中断：已由 onCancelDownload 提示过，这里只同步状态
      cancelRequested.value = false
      await refresh().catch(() => {})
      return
    }
    toast.error(error instanceof Error ? error.message : String(error))
    await refresh().catch(() => {})
  } finally {
    loading.value = false
    cancelRequested.value = false
  }
}

function onInstallGithub() {
  return runAction(() => invokeWb2apiIpc(channels.value!.INSTALL), '安装完成，可点击启动')
}

function onInstallZip() {
  return runAction(() => invokeWb2apiIpc(channels.value!.INSTALL_FROM_ZIP), '安装完成，可点击启动')
}

// 不走 runAction：它会置 loading、把取消本身当成一次「动作」等返回；这里只是给正在跑的
// 那次 install / update 发一个中止信号，因此必须随时可点、也不阻塞其它按钮。
async function onCancelDownload() {
  cancelling.value = true
  cancelRequested.value = true
  try {
    const result = await invokeWb2apiIpc(channels.value!.CANCEL_DOWNLOAD) as { cancelled: boolean }
    if (result.cancelled) {
      toast.info('已取消下载，临时文件已清理')
    } else {
      cancelRequested.value = false
      toast.info('当前没有进行中的下载')
    }
  } catch (error) {
    cancelRequested.value = false
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    cancelling.value = false
  }
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
  // 检查更新只服务「已安装」后的升级判断：没装时「可更新」没有比较基准，
  // 顺手点「应用更新」还会退化成重装。按钮已禁用，这里再兜一层（键盘 / 程序触发）。
  if (!installed.value) {
    toast.info('安装后才能检查更新')
    return
  }
  if (busy.value) return
  loading.value = true
  try {
    const info = await invokeWb2apiIpc(channels.value!.CHECK_UPDATE) as Wb2apiUpdateInfo
    if (!info.hasUpdate) toast.success('已是最新版本')
    // 结果已缓存在主进程，这里刷一次让面板（含已安装版本对照）取到同一份结论
    await refresh()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}

async function onApplyUpdate() {
  if (!installed.value) {
    toast.info('安装后才能应用更新')
    return
  }
  if (busy.value) return
  const info = updateInfo.value
  // 「应用更新」只消费已有的检查结果（按钮无可用更新时本就禁用）：
  // 这里不再顺手触发检查，避免一次点击里跑两个动作、loading 互相覆盖。
  if (!info?.hasUpdate) {
    toast.info('没有可用更新，请先「检查更新」')
    return
  }
  try {
    await confirm(
      `将更新到 ${info.latestTag}（${info.assetName}）。失败会回滚 previous。`,
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
  // 终态不留常驻文案：完成 / 取消都有 toast，结果也由「已安装」行与状态面板表达；
  // 留着只会让「安装完成」一直挂在面板上，看起来像还有事没做完。
  if (p.phase === 'done' || p.phase === 'cancelled') return ''
  if (p.phase === 'download' && p.totalBytes > 0) {
    const pct = Math.min(100, Math.round((p.downloadedBytes / p.totalBytes) * 100))
    return `${p.message ?? '下载中'} ${pct}%`
  }
  return p.message || p.error || p.phase
})

const progressPercent = computed(() => {
  const p = progress.value
  if (!p || p.phase !== 'download' || p.totalBytes <= 0) return null
  return Math.min(100, Math.max(0, Math.round((p.downloadedBytes / p.totalBytes) * 100)))
})

/**
 * 取消只在下载阶段开放：校验 / 解压 / 晋升不可中断，这几段继续显示按钮只会骗人。
 * 判据不看 loading —— 下载期间 INSTALL 调用还没返回，loading 恒为 true。
 */
const canCancelDownload = computed(() =>
  state.value?.updating === true && progress.value?.phase === 'download',
)

function openInspector(tab: InspectorTab = 'run') {
  inspectorTab.value = tab
  inspectorOpen.value = true
}

function selectInspectorTab(value: string) {
  if (value === 'run' || value === 'install' || value === 'diagnostics') {
    inspectorTab.value = value
  }
}

function openPanelInBrowser() {
  if (panelSrc.value) openExternal(panelSrc.value)
}

let offState: (() => void) | null = null
let offProgress: (() => void) | null = null
let unguard: (() => void) | null = null

onMounted(() => {
  if (!channels.value) return
  offState = onWb2apiIpc(channels.value.EVENT_STATE, (payload) => {
    applyState(payload as Wb2apiPanelState)
  })
  offProgress = onWb2apiIpc(channels.value.EVENT_PROGRESS, (payload) => {
    progress.value = payload as Wb2apiProgressEvent
  })
  void invokeWb2apiIpc(channels.value.RUNTIME_ACTIVATE)
    .then(() => refresh())
    .catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error))
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
        await confirm('关闭将停止服务', '关闭页签', {
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
      toast.error(error instanceof Error ? error.message : String(error))
      return false
    }
  })
})

onUnmounted(() => {
  offState?.()
  offProgress?.()
  unguard?.()
  const shouldStop = isRunning.value || state.value?.updating === true
  if (shouldStop && channels.value) {
    void invokeWb2apiIpc(channels.value.STOP).catch(() => undefined)
  }
  if (channels.value) {
    void invokeWb2apiIpc(channels.value.RUNTIME_DEACTIVATE).catch(() => undefined)
  }
})
</script>

<template>
  <div class="tool-page wb2api-page">
    <WorkspaceHeader
      icon="wb2api"
      title="WorkBuddy2API"
      description="内嵌上游管理面板；安装、启停与诊断按需展开"
      :status-label="statusLabel"
      :status-tone="statusTone"
    >
      <template #actions>
        <UiButton size="small" @click="openInspector('run')">
          运行详情
        </UiButton>
        <UiButton
          v-if="!isRunning"
          size="small"
          type="primary"
          :disabled="busy || !installed || state?.orphanLikely"
          @click="onStart"
        >
          启动
        </UiButton>
        <UiButton
          v-else
          size="small"
          type="warning"
          plain
          :disabled="busy"
          @click="onStop"
        >
          停止
        </UiButton>
      </template>
    </WorkspaceHeader>

    <div class="wb2api-layout">
      <ToolSurface class="wb2api-surface">
        <template #toolbar>
          <UiToolbar gap="sm" flush>
            <UiStatusTag :tone="statusTone" :pulsing="status === 'running'" />
            <span class="wb2api-status-label">{{ statusLabel }}</span>
            <UiChip v-if="state?.version" mono>
              v{{ state.version }}
            </UiChip>
            <UiChip v-if="state?.orphanLikely" tone="warning">
              端口被外部进程占用
            </UiChip>
            <template #end>
              <UiIconButton icon="refresh" label="刷新状态" :disabled="loading" @click="refresh" />
              <UiIconButton icon="external" label="在浏览器打开面板" :disabled="!panelSrc" @click="openPanelInBrowser" />
              <UiIconButton icon="info" label="运行详情" :active="inspectorOpen" @click="openInspector('run')" />
            </template>
          </UiToolbar>
        </template>

        <div class="wb2api-stage">
          <UiAlert
            v-if="state?.orphanLikely"
            class="wb2api-alert"
            type="warning"
            :closable="false"
            show-icon
            title="端口被非本工具托管的进程占用"
            description="可以结束占用进程后重试，工具不会接管外部服务。"
          />
          <UiAlert
            v-else-if="state?.lastError && !showWebview"
            class="wb2api-alert"
            type="error"
            :closable="false"
            show-icon
            title="服务启动失败"
            :description="state.lastError"
          />

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
            :text="emptyText"
          >
            <template #actions>
              <UiButton size="small" @click="openInspector(installed ? 'run' : 'install')">
                {{ installed ? '查看运行详情' : '安装上游二进制' }}
              </UiButton>
            </template>
          </UiEmpty>
        </div>

        <template #statusline>
          <span>WORKBUDDY2API</span>
          <span class="mono">127.0.0.1:{{ endpointPort }}</span>
          <span v-if="state?.version">v{{ state.version }}</span>
          <span class="status-spacer" />
          <span>{{ isRunning ? 'SERVICE RUNNING' : 'SERVICE STOPPED' }}</span>
        </template>
      </ToolSurface>

      <ToolSideInspector
        :open="inspectorOpen"
        :title="inspectorTitle"
        :width="360"
        body-padding="12px"
        @close="inspectorOpen = false"
      >
        <div class="inspector-content">
          <UiMenuHorizontal
            :model-value="inspectorTab"
            :items="inspectorMenu"
            @update:model-value="selectInspectorTab"
          />

          <div class="side-scroll">
            <div v-if="inspectorTab === 'run'" class="inspector-sections">
              <section class="inspector-section">
                <header class="inspector-section-head">
                  <div>
                    <strong>服务状态</strong>
                    <span>{{ statusLabel }}</span>
                  </div>
                  <UiStatusTag :tone="statusTone" :pulsing="status === 'running'" />
                </header>
                <div class="inspector-actions">
                  <UiButton
                    v-if="!isRunning"
                    size="small"
                    type="primary"
                    :disabled="busy || !installed || state?.orphanLikely"
                    @click="onStart"
                  >
                    启动
                  </UiButton>
                  <template v-else>
                    <UiButton size="small" :disabled="busy" @click="onStop">
                      停止
                    </UiButton>
                    <UiButton size="small" :disabled="busy || !installed" @click="onRestart">
                      重启
                    </UiButton>
                  </template>
                  <UiButton v-if="state?.orphanLikely" size="small" type="warning" :disabled="busy" @click="onKillOrphan">
                    结束占用
                  </UiButton>
                </div>
                <UiKeyValue label="版本" mono label-width="74px">
                  {{ state?.version ?? '—' }}
                </UiKeyValue>
                <UiKeyValue class="wb2api-kv-inline" label="面板" mono label-width="74px">
                  <span class="wb2api-endpoint" :title="panelUrl">{{ panelUrl }}</span>
                  <template #actions>
                    <UiCopyButton :text="panelUrl" label="面板地址" />
                  </template>
                </UiKeyValue>
                <UiKeyValue class="wb2api-kv-inline" label="OpenAI" mono label-width="74px">
                  <span class="wb2api-endpoint" :title="openAiBaseUrl">{{ openAiBaseUrl }}</span>
                  <template #actions>
                    <UiCopyButton :text="openAiBaseUrl" label="OpenAI Base URL" />
                  </template>
                </UiKeyValue>
                <UiKeyValue class="wb2api-kv-inline" label="Anthropic" mono label-width="74px">
                  <span class="wb2api-endpoint" :title="anthropicBaseUrl">{{ anthropicBaseUrl }}</span>
                  <template #actions>
                    <UiCopyButton :text="anthropicBaseUrl" label="Anthropic Base URL" />
                  </template>
                </UiKeyValue>
                <UiKeyValue class="wb2api-kv-inline" label="API Key" mono label-width="74px">
                  <span class="wb2api-api-key" :title="apiKeyVisible ? (state?.apiKey ?? '') : ''">{{ apiKeyDisplay }}</span>
                  <template v-if="state?.apiKey" #actions>
                    <UiButton size="small" text @click="apiKeyVisible = !apiKeyVisible">
                      {{ apiKeyVisible ? '隐藏' : '显示' }}
                    </UiButton>
                    <UiCopyButton :text="state.apiKey" label="API Key" />
                  </template>
                </UiKeyValue>
              </section>
            </div>

            <div v-else-if="inspectorTab === 'install'" class="inspector-sections">
              <section class="inspector-section">
                <header class="inspector-section-head">
                  <div>
                    <strong>安装 / 更新</strong>
                    <span>{{ state?.version ? `当前 v${state.version}` : '尚未安装' }}</span>
                  </div>
                </header>
                <div class="inspector-actions">
                  <UiButton :disabled="busy || isRunning || state?.orphanLikely" @click="onInstallGithub">
                    GitHub 安装
                  </UiButton>
                  <UiButton :disabled="busy || isRunning || state?.orphanLikely" @click="onInstallZip">
                    本地 ZIP
                  </UiButton>
                </div>
                <div class="inspector-actions">
                  <UiButton size="small" :disabled="busy || !installed || isRunning" @click="onCheckUpdate">
                    检查更新
                  </UiButton>
                  <UiButton
                    size="small"
                    type="primary"
                    plain
                    :disabled="busy || !installed || !updateInfo?.hasUpdate || state?.orphanLikely"
                    @click="onApplyUpdate"
                  >
                    应用更新
                  </UiButton>
                  <UiButton
                    v-if="canCancelDownload"
                    size="small"
                    :loading="cancelling"
                    @click="onCancelDownload"
                  >
                    取消下载
                  </UiButton>
                </div>
                <UiProgress
                  v-if="progressPercent !== null"
                  :percentage="progressPercent"
                />
                <UiHint v-if="updateInfo" block>
                  最新 {{ updateInfo.latestTag }}
                  <span v-if="updateInfo.hasUpdate">（可更新）</span>
                  <span v-else>（已最新）</span>
                </UiHint>
                <UiHint v-if="progressText" block>
                  {{ progressText }}
                </UiHint>
                <UiButton size="small" text @click="onOpenDataDir">
                  打开数据目录
                </UiButton>
              </section>
            </div>

            <div v-else class="inspector-sections">
              <section class="inspector-section">
                <header class="inspector-section-head">
                  <div>
                    <strong>诊断</strong>
                    <span>本机托管进程与最近错误</span>
                  </div>
                </header>
                <UiHint block>
                  二进制不随 edt 安装包分发；打开页签不会自动启动，切换工具、返回首页或关闭页签都会停止服务。
                </UiHint>
                <UiHint v-if="state?.orphanLikely" block>
                  端口被其它进程占用。工具可以结束它，但不会接管。
                </UiHint>
                <div v-if="state?.lastError" class="wb2api-diagnostic-error">
                  <span>最近错误</span>
                  <pre class="mono">{{ state.lastError }}</pre>
                </div>
                <UiHint v-else block>
                  暂无错误记录。
                </UiHint>
                <UiButton size="small" text @click="openUpstreamRepo">
                  打开上游仓库
                </UiButton>
              </section>
            </div>
          </div>
        </div>
      </ToolSideInspector>
    </div>
  </div>
</template>

<style scoped lang="scss">
.wb2api-page {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0 18px 18px;
  overflow: hidden;
}

.wb2api-layout {
  display: flex;
  flex: 1;
  gap: 12px;
  min-height: 0;
}

.wb2api-surface {
  min-width: 0;
  min-height: 0;
}

.wb2api-stage {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-fill) 24%, transparent);
}

.wb2api-alert {
  flex: none;
  margin: 12px;
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
  padding: 28px;
}

.wb2api-status-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.inspector-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: var(--spacing-sm);
}

.side-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
}

.inspector-sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.inspector-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border-light);

  &:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }
}

.inspector-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-sm);

  > div {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  strong {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
  }

  span {
    color: var(--color-text-tertiary);
    font-size: var(--font-size-xs);
    line-height: 1.45;
  }
}

.inspector-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
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

.wb2api-diagnostic-error {
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px solid color-mix(in srgb, var(--color-error) 24%, var(--color-border-light));
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-error) 6%, transparent);

  span {
    color: var(--color-error);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
  }
}

.wb2api-diagnostic-error pre {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 10px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.status-spacer {
  flex: 1;
}
</style>
