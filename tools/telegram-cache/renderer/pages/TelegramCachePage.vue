<script setup lang="ts">
import type { WebviewTag } from '../webview'
import { isElectronEnvironment } from '@renderer/shared/environment'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { toast } from 'vue-sonner'
import ToolSideInspector from '../../../../renderer/shared/components/workspace/ToolSideInspector.vue'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import WorkspaceHeader from '../../../../renderer/shared/components/workspace/WorkspaceHeader.vue'
import { TELEGRAM_WEBVIEW_PARTITION } from '../../../../shared/webview'
import DiagnosticsPanel from '../components/DiagnosticsPanel.vue'
import LibraryPanel from '../components/LibraryPanel.vue'
import OverviewPanel from '../components/OverviewPanel.vue'
import TasksPanel from '../components/TasksPanel.vue'
import { useTelegramCacheStore } from '../stores/telegramCacheStore'
import { tabKeyFromPath, TELEGRAM_CACHE_TABS } from '../tabs'
import { sanitizePageUrl } from '../utils/format'

const route = useRoute()
const router = useRouter()
const store = useTelegramCacheStore()
const isElectron = isElectronEnvironment()

const webviewRef = shallowRef<WebviewTag | null>(null)
const boundElements = new WeakSet<object>()
const pageUrl = ref('')
const loading = ref(true)
const loadError = ref('')
const initError = ref('')
const canGoBack = ref(false)
const canGoForward = ref(false)
const devtoolsOpen = ref(false)
const inspectorOpen = ref(false)

const site = computed(() => store.site)
const pageSrc = computed(() => site.value?.url ?? '')
const siteError = computed(() => site.value?.error ?? '')

// origin 变了 = 页面侧登录态（localStorage）、IndexedDB、Cache Storage 已经对不上，必须明确提示。
const originNotice = computed(() => (site.value?.originChanged ? site.value.portNote ?? '' : ''))
const originNoticeDismissed = ref(false)
watch(originNotice, () => {
  originNoticeDismissed.value = false
})

const activeTab = computed(() => tabKeyFromPath(route.path))
const PANELS = {
  overview: OverviewPanel,
  tasks: TasksPanel,
  diagnostics: DiagnosticsPanel,
  library: LibraryPanel,
} as const
const activePanel = computed(() => PANELS[activeTab.value])
const inspectorTitle = computed(() =>
  TELEGRAM_CACHE_TABS.find(tab => tab.key === activeTab.value)?.label ?? '工具详情',
)

const displayUrl = computed(() => sanitizePageUrl(pageUrl.value) || pageSrc.value)

/** 「进度」页签的角标 = 还没归档完的消息数（与 TasksPanel 的口径一致） */
const pendingArchives = computed(() => store.library.filter(entry => entry.state !== 'complete').length)
const statusLabel = computed(() => {
  if (initError.value) return '后端未就绪'
  if (loadError.value) return '页面加载失败'
  if (!site.value?.url) return siteError.value ? '站点未就绪' : '正在启动'
  return originNotice.value ? '登录态已重置' : '本地站点已就绪'
})
const statusTone = computed<'neutral' | 'success' | 'warning' | 'danger'>(() => {
  if (initError.value || loadError.value) return 'danger'
  if (!site.value?.url || originNotice.value) return 'warning'
  return 'success'
})

const menuItems = computed(() => TELEGRAM_CACHE_TABS.map(tab => ({
  value: tab.key as string,
  label: tab.label,
  badge: tab.key === 'tasks'
    ? pendingArchives.value
    : tab.key === 'library'
      ? store.library.length
      : undefined,
})))

function safeCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function syncNavigation(wv: WebviewTag): void {
  canGoBack.value = safeCall(() => wv.canGoBack(), false)
  canGoForward.value = safeCall(() => wv.canGoForward(), false)
  devtoolsOpen.value = safeCall(() => wv.isDevToolsOpened(), false)
}

async function attachPage(): Promise<void> {
  const wv = webviewRef.value
  if (!wv) return
  const id = safeCall(() => wv.getWebContentsId(), 0)
  if (!Number.isInteger(id) || id <= 0) {
    toast.warning('页面内核尚未就绪，请稍后重试')
    return
  }
  try {
    await store.attachPage(id)
  } catch (error) {
    toast.warning(`页面未绑定：${(error as Error).message}`)
  }
}

function bindWebview(el: unknown): void {
  if (!el) return
  const wv = el as WebviewTag
  webviewRef.value = wv
  if (boundElements.has(wv)) return
  boundElements.add(wv)

  wv.addEventListener('did-start-loading', () => {
    loading.value = true
  })
  wv.addEventListener('did-stop-loading', () => {
    loading.value = false
    syncNavigation(wv)
  })
  wv.addEventListener('dom-ready', () => {
    loading.value = false
    pageUrl.value = safeCall(() => wv.getURL(), pageUrl.value)
    syncNavigation(wv)
    void attachPage()
  })
  wv.addEventListener('did-navigate', (event) => {
    pageUrl.value = (event as { url?: string }).url || pageUrl.value
    loadError.value = ''
    syncNavigation(wv)
    devtoolsOpen.value = safeCall(() => wv.isDevToolsOpened(), false)
  })
  wv.addEventListener('did-navigate-in-page', (event) => {
    pageUrl.value = (event as { url?: string }).url || pageUrl.value
  })
  wv.addEventListener('did-fail-load', (event) => {
    const detail = event as { errorCode?: number, errorDescription?: string, validatedURL?: string }
    // -3 = ERR_ABORTED（页面内跳转 / 用户取消），不是真实失败
    if (detail.errorCode && detail.errorCode !== -3) {
      loadError.value = `${detail.errorDescription || '加载失败'}（${detail.validatedURL || ''}）`
    }
  })
}

function goBack(): void {
  safeCall(() => webviewRef.value?.goBack(), undefined)
}

function goForward(): void {
  safeCall(() => webviewRef.value?.goForward(), undefined)
}

/** 影库「消息链接」：让内嵌页面切到该消息（页面侧 window.__EDT_JUMP_TO_MESSAGE__） */
async function runJump(jump: { peerId: string, messageId: number }): Promise<void> {
  const wv = webviewRef.value
  if (!wv) {
    toast.warning('聊天页面尚未就绪')
    return
  }
  if (!/^-?\d{1,20}$/.test(jump.peerId) || !Number.isSafeInteger(jump.messageId)) return

  const script = '(() => {'
    + 'const fn = window.__EDT_JUMP_TO_MESSAGE__;'
    + `return typeof fn === 'function' ? fn(${JSON.stringify(jump.peerId)}, ${jump.messageId}) : false;`
    + '})()'
  try {
    const jumped = await wv.executeJavaScript(script, true)
    if (!jumped) toast.warning('该会话还没有在 Telegram 里加载，请先在左侧打开它')
  } catch (error) {
    toast.error(`跳转失败：${(error as Error).message}`)
  }
}

watch(() => store.pendingJump, () => {
  const jump = store.consumeJump()
  if (jump) void runJump(jump)
})

function reload(): void {
  loadError.value = ''
  loading.value = true
  safeCall(() => webviewRef.value?.reload(), undefined)
}

function toggleDevTools(): void {
  const wv = webviewRef.value
  if (!wv) return
  try {
    if (wv.isDevToolsOpened()) wv.closeDevTools()
    else wv.openDevTools()
    devtoolsOpen.value = wv.isDevToolsOpened()
  } catch (error) {
    toast.warning((error as Error).message || '无法打开开发者工具')
  }
}

function openInBrowser(): void {
  const url = pageUrl.value || pageSrc.value
  if (!url) return
  openExternal(url)
}

function switchTab(key: string): void {
  if (key === activeTab.value) return
  const tab = TELEGRAM_CACHE_TABS.find(item => item.key === key)
  if (tab) {
    inspectorOpen.value = true
    router.push({ name: tab.routeName })
  }
}

function openInspector(): void {
  inspectorOpen.value = true
}

watch(activeTab, (tab) => {
  if (tab !== 'overview') inspectorOpen.value = true
}, { immediate: true })

onMounted(async () => {
  if (!isElectron) return
  try {
    await store.init()
  } catch (error) {
    initError.value = (error as Error).message
  }
  // 概览/进度的角标都读 library，进页面就先扫一次（影库面板自己也会再刷一次）
  void store.loadLibrary().catch(() => undefined)
})

onUnmounted(() => {
  const wv = webviewRef.value
  if (wv && devtoolsOpen.value) safeCall(() => wv.closeDevTools(), undefined)
  webviewRef.value = null
  store.dispose()
})
</script>

<template>
  <div class="tool-page telegram-page">
    <WorkspaceHeader
      icon="telegram"
      title="Telegram 网络优化"
      description="内嵌 Telegram 页面；任务、诊断与影库按需展开"
      :status-label="statusLabel"
      :status-tone="statusTone"
    >
      <template #actions>
        <UiButton size="small" @click="openInspector">
          工具详情
        </UiButton>
        <UiButton size="small" type="primary" :disabled="!displayUrl" @click="openInBrowser">
          外部打开
        </UiButton>
      </template>
    </WorkspaceHeader>

    <div class="embedded-stage">
      <ToolSurface class="telegram-surface">
        <template #toolbar>
          <UiToolbar gap="sm" flush>
            <UiIconButton icon="arrowLeft" label="后退" :disabled="!canGoBack" @click="goBack" />
            <UiIconButton icon="arrowRight" label="前进" :disabled="!canGoForward" @click="goForward" />
            <UiIconButton icon="refresh" label="刷新页面" @click="reload" />
            <span class="url-pill mono" :title="displayUrl">{{ displayUrl }}</span>
            <span v-if="loading" class="loading-dot" aria-label="加载中" />

            <template #end>
              <UiIconButton icon="script" label="页面开发者工具" :active="devtoolsOpen" @click="toggleDevTools" />
              <UiIconButton
                icon="info"
                label="工具详情"
                :active="inspectorOpen"
                @click="openInspector"
              />
            </template>
          </UiToolbar>
        </template>

        <div class="browser-stage">
          <UiAlert
            v-if="initError"
            class="pane-alert"
            type="warning"
            :closable="false"
            show-icon
            title="后端未就绪"
            :description="`${initError}。请确认在 everydaytool 桌面端运行（网页预览没有主进程 IPC）。`"
          />
          <UiAlert
            v-else-if="!isElectron"
            class="pane-alert"
            type="info"
            :closable="false"
            show-icon
            title="网页预览不支持内嵌 Telegram"
            description="请使用 everydaytool 桌面端打开本工具。"
          />
          <UiAlert
            v-else-if="!pageSrc"
            class="pane-alert"
            type="warning"
            :closable="false"
            show-icon
            title="本地 Telegram 客户端未就绪"
            :description="siteError || '正在启动本地站点…'"
          />
          <UiAlert
            v-else-if="originNotice && !originNoticeDismissed"
            class="pane-alert"
            type="warning"
            show-icon
            title="本地站点端口已变化：页面登录态已重置"
            :description="originNotice"
            @close="originNoticeDismissed = true"
          />

          <webview
            v-if="isElectron && pageSrc"
            :ref="bindWebview"
            :partition="TELEGRAM_WEBVIEW_PARTITION"
            :src="pageSrc"
            class="telegram-webview"
          />

          <div v-if="loading && pageSrc && !loadError" class="browser-overlay">
            <span class="muted">正在加载 Telegram…</span>
          </div>

          <div v-if="loadError" class="browser-overlay is-error">
            <span class="error-text">{{ loadError }}</span>
            <UiGroup gap="sm">
              <UiButton size="small" type="primary" @click="reload">
                重试
              </UiButton>
              <UiButton size="small" @click="openInBrowser">
                在系统浏览器打开
              </UiButton>
            </UiGroup>
          </div>
        </div>

        <template #statusline>
          <span>TELEGRAM LOCAL</span>
          <span v-if="store.site?.port" class="mono">PORT {{ store.site.port }}</span>
          <span v-if="pendingArchives > 0">{{ pendingArchives }} 个归档进行中</span>
          <span class="status-spacer" />
          <span>{{ inspectorOpen ? 'INSPECTOR ON' : 'WEBVIEW ONLY' }}</span>
        </template>
      </ToolSurface>

      <ToolSideInspector
        :open="inspectorOpen"
        :title="inspectorTitle"
        :width="360"
        @close="inspectorOpen = false"
      >
        <div class="inspector-content">
          <UiMenuHorizontal :model-value="activeTab" :items="menuItems" @update:model-value="switchTab" />
          <div class="side-scroll">
            <KeepAlive>
              <component :is="activePanel" />
            </KeepAlive>
          </div>
        </div>
      </ToolSideInspector>
    </div>
  </div>
</template>

<style scoped lang="scss">
.telegram-page {
  display: flex;
  flex-direction: column;
  padding: 0 18px 18px;
  overflow: hidden;
}

.embedded-stage {
  display: flex;
  flex: 1;
  gap: 12px;
  min-height: 0;
}

.telegram-surface {
  min-width: 0;
  min-height: 0;
}

.url-pill {
  flex: 1;
  min-width: 0;
  padding: var(--spacing-xs) var(--spacing-md);
  border-radius: 999px;
  background: var(--color-fill);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-control);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.loading-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
  animation: telegram-pulse 1.2s ease-in-out infinite;
}

@keyframes telegram-pulse {
  0%,
  100% {
    opacity: 0.35;
  }

  50% {
    opacity: 1;
  }
}

.browser-stage {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.pane-alert {
  flex: none;
  margin: 12px;
}

.telegram-webview {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
  background: var(--color-on-solid);
}

.browser-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  background: color-mix(in oklab, var(--color-raised) 88%, transparent);
  backdrop-filter: var(--glass-raised);
  text-align: center;

  &.is-error {
    background: color-mix(in oklab, var(--color-raised) 94%, transparent);
  }
}

.error-text {
  color: var(--color-error);
  font-size: var(--font-size-sm);
  word-break: break-all;
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

.status-spacer {
  flex: 1;
}
</style>
