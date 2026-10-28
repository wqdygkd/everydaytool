<script setup lang="ts">
import type {
  Wb2apiPanelState,
  Wb2apiProgressEvent,
  Wb2apiUpdateInfo,
} from '@shared/workbuddy2api-panel'
import {
  buildWb2apiAnthropicBaseUrl,
  buildWb2apiOpenAiBaseUrl,
  buildWb2apiPanelUrl,
  WB2API_DEFAULT_PORT,
  WB2API_GITHUB_REPO_SLUG,
  WB2API_TOOL_ID,
  wb2apiStatusLabel,
} from '@shared/workbuddy2api-panel'
import { ElMessage, ElMessageBox } from 'element-plus'
import { registerTabCloseGuard } from '@/shared/composables/useTabCloseGuard'
import { getWorkbuddyApi, openExternal } from '../api'
import { usePanelWebview } from '../composables/usePanelWebview'

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

// 检查更新的结果缓存在主进程（state.update）：重开页签 / 刷新都在，渲染层不再自留一份副本。
// 已安装版本来自 manifest（state.version），与检查结果里的 currentVersion 同源现算。
const updateInfo = computed(() => state.value?.update ?? null)

const apiKeyDisplay = computed(() => {
  const key = state.value?.apiKey
  if (!key) return '—'
  return apiKeyVisible.value ? key : '••••••••••••'
})

// 面板内嵌 Webview：Tauri 子 Webview 按宿主元素几何摆放（见 composables/usePanelWebview.ts）
const { host: panelHost, ensure: ensurePanelWebview, destroy: destroyPanelWebview } = usePanelWebview()

const api = computed(() => getWorkbuddyApi())
const channels = computed(() => api.value?.commands ?? null)

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
    const next = await api.value!.invoke(channels.value!.GET_STATE) as Wb2apiPanelState
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
    if (cancelRequested.value) {
      // 主动取消引发的中断：已由 onCancelDownload 提示过，这里只同步状态
      cancelRequested.value = false
      await refresh().catch(() => {})
      return
    }
    ElMessage.error(error instanceof Error ? error.message : String(error))
    await refresh().catch(() => {})
  } finally {
    loading.value = false
    cancelRequested.value = false
  }
}

function onInstallGithub() {
  return runAction(() => api.value!.invoke(channels.value!.INSTALL), '安装完成，可点击启动')
}

function onInstallZip() {
  return runAction(() => api.value!.invoke(channels.value!.INSTALL_FROM_ZIP), '安装完成，可点击启动')
}

// 不走 runAction：它会置 loading、把取消本身当成一次「动作」等返回；这里只是给正在跑的
// 那次 install / update 发一个中止信号，因此必须随时可点、也不阻塞其它按钮。
async function onCancelDownload() {
  cancelling.value = true
  cancelRequested.value = true
  try {
    const result = await api.value!.invoke(channels.value!.CANCEL_DOWNLOAD) as { cancelled: boolean }
    if (result.cancelled) {
      ElMessage.info('已取消下载，临时文件已清理')
    } else {
      cancelRequested.value = false
      ElMessage.info('当前没有进行中的下载')
    }
  } catch (error) {
    cancelRequested.value = false
    ElMessage.error(error instanceof Error ? error.message : String(error))
  } finally {
    cancelling.value = false
  }
}

function onStart() {
  return runAction(() => api.value!.invoke(channels.value!.START), '已启动')
}

function onStop() {
  return runAction(() => api.value!.invoke(channels.value!.STOP), '已停止')
}

function onRestart() {
  return runAction(() => api.value!.invoke(channels.value!.RESTART), '已重启')
}

function onKillOrphan() {
  return runAction(() => api.value!.invoke(channels.value!.KILL_ORPHAN), '已结束占用进程')
}

function onOpenDataDir() {
  return runAction(() => api.value!.invoke(channels.value!.OPEN_DATA_DIR))
}

async function onCheckUpdate() {
  // 检查更新只服务「已安装」后的升级判断：没装时「可更新」没有比较基准，
  // 顺手点「应用更新」还会退化成重装。按钮已禁用，这里再兜一层（键盘 / 程序触发）。
  if (!installed.value) {
    ElMessage.info('安装后才能检查更新')
    return
  }
  if (busy.value) return
  loading.value = true
  try {
    const info = await api.value!.invoke(channels.value!.CHECK_UPDATE) as Wb2apiUpdateInfo
    if (!info.hasUpdate) ElMessage.success('已是最新版本')
    // 结果已缓存在主进程，这里刷一次让面板（含已安装版本对照）取到同一份结论
    await refresh()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  } finally {
    loading.value = false
  }
}

async function onApplyUpdate() {
  if (!installed.value) {
    ElMessage.info('安装后才能应用更新')
    return
  }
  if (busy.value) return
  const info = updateInfo.value
  // 「应用更新」只消费已有的检查结果（按钮无可用更新时本就禁用）：
  // 这里不再顺手触发检查，避免一次点击里跑两个动作、loading 互相覆盖。
  if (!info?.hasUpdate) {
    ElMessage.info('没有可用更新，请先「检查更新」')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将更新到 ${info.latestTag}（${info.assetName}）。失败会回滚 previous。`,
      '确认更新',
      { confirmButtonText: '更新', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  return runAction(() => api.value!.invoke(channels.value!.APPLY_UPDATE), '更新完成')
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

/**
 * 取消只在下载阶段开放：校验 / 解压 / 晋升不可中断，这几段继续显示按钮只会骗人。
 * 判据不看 loading —— 下载期间 INSTALL 调用还没返回，loading 恒为 true。
 */
const canCancelDownload = computed(() =>
  state.value?.updating === true && progress.value?.phase === 'download',
)

let offState: (() => void) | null = null
let offProgress: (() => void) | null = null
let unguard: (() => void) | null = null

// 面板可见即创建子 Webview，隐藏则销毁（关页签后不再占着 WebView2 进程）
watch([showWebview, panelSrc, panelHost], ([visible, src, element]) => {
  if (!visible || !src || !element) {
    void destroyPanelWebview()
    return
  }
  void ensurePanelWebview(src)
})

onMounted(() => {
  if (!api.value) return
  void refresh()
  offState = api.value.on(channels.value!.EVENT_STATE, (payload) => {
    applyState(payload as Wb2apiPanelState)
  })
  offProgress = api.value.on(channels.value!.EVENT_PROGRESS, (payload) => {
    progress.value = payload as Wb2apiProgressEvent
  })

  // 关页签 = 停服务（可短确认）
  unguard = registerTabCloseGuard(WB2API_TOOL_ID, async () => {
    try {
      const current = await api.value!.invoke(channels.value!.GET_STATE) as Wb2apiPanelState
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
      await api.value!.invoke(channels.value!.STOP)
      return true
    } catch (error) {
      // 查询状态失败不该把页签锁死：提示一下并按放行处理（服务没在跑也就不需要停）
      ElMessage.warning(`未能确认服务状态，直接关闭：${error instanceof Error ? error.message : String(error)}`)
      return true
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
        <!-- 子 Webview 由 Rust 侧按这个宿主的几何摆放；div 本身只占位 -->
        <div
          v-if="showWebview && panelSrc"
          ref="panelHost"
          class="wb2api-webview-host"
        />
        <UiEmpty
          v-else
          class="wb2api-empty"
          center
          icon="wb2api"
          :text="emptyText"
        />
      </section>

      <aside class="wb2api-ops">
        <UiPanel title="启停" padding="var(--spacing-md)">
          <div class="wb2api-actions">
            <el-button
              type="primary"
              :disabled="busy || !installed || isRunning || state?.orphanLikely"
              @click="onStart"
            >
              启动
            </el-button>
            <el-button :disabled="busy || !isRunning" @click="onStop">
              停止
            </el-button>
            <el-button :disabled="busy || !installed" @click="onRestart">
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
            :disabled="busy"
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
            <span class="wb2api-status-label">{{ statusLabel }}</span>
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
          <!-- 已安装版本（来自 manifest）：不用点「检查更新」也知道当前装的是哪一版。
               没装出这一行——否则标签「已安装」配值「未安装」会自相矛盾。 -->
          <UiKeyValue v-if="state?.version" class="wb2api-installed" label="已安装" label-width="72px" mono muted>
            {{ state.version }}
          </UiKeyValue>
          <div class="wb2api-actions">
            <!-- 运行中 / 端口被占用时不允许换版本：旧二进制还在执行，Windows 下 current/ 换不掉 -->
            <el-button :disabled="busy || isRunning || state?.orphanLikely" @click="onInstallGithub">
              GitHub 安装
            </el-button>
            <el-button :disabled="busy || isRunning || state?.orphanLikely" @click="onInstallZip">
              本地 ZIP
            </el-button>
          </div>
          <div class="wb2api-actions">
            <!-- 检查 / 应用更新只对「已安装」开放（applyUpdate 在没有 current 时等于重装）；
                 运行中只禁「检查更新」，用禁用态表达，不额外堆提示文案。 -->
            <el-button size="small" :disabled="busy || !installed || isRunning" @click="onCheckUpdate">
              检查更新
            </el-button>
            <el-button
              size="small"
              type="primary"
              plain
              :disabled="busy || !installed || !updateInfo?.hasUpdate || state?.orphanLikely"
              @click="onApplyUpdate"
            >
              应用更新
            </el-button>
            <el-button
              v-if="canCancelDownload"
              size="small"
              :loading="cancelling"
              @click="onCancelDownload"
            >
              取消下载
            </el-button>
          </div>
          <UiHint v-if="updateInfo" class="wb2api-hint">
            最新 {{ updateInfo.latestTag }}
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

/* 宿主只负责几何：真正的页面画在它上层的 Tauri 子 Webview 里 */
.wb2api-webview-host {
  flex: 1;
  width: 100%;
  min-height: 0;
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

/* 「已安装」行（UiKeyValue muted 无内边距）与提示行同构：统一与下一段拉开间距 */
.wb2api-installed,
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
