<script setup lang="ts">
import type { WebviewTag } from '../webview'
import { isElectronEnvironment } from '@renderer/shared/environment'
import { TELEGRAM_DEFAULT_URL } from '../../../../shared/telegram-cache'
import { TELEGRAM_WEBVIEW_PARTITION } from '../../../../shared/webview'
import DiagnosticsPanel from '../components/DiagnosticsPanel.vue'
import OverviewPanel from '../components/OverviewPanel.vue'
import ResourcesPanel from '../components/ResourcesPanel.vue'
import TasksPanel from '../components/TasksPanel.vue'
import { openExternal } from '../ipc'
import { useTelegramCacheStore } from '../stores/telegramCacheStore'
import { tabKeyFromPath, TELEGRAM_CACHE_TABS } from '../tabs'
import { sanitizePageUrl } from '../utils/format'

const route = useRoute()
const router = useRouter()
const store = useTelegramCacheStore()
const isElectron = isElectronEnvironment()

const webviewRef = shallowRef<WebviewTag | null>(null)
const boundElements = new WeakSet<object>()
const pageUrl = ref(TELEGRAM_DEFAULT_URL)
const loading = ref(true)
const loadError = ref('')
const initError = ref('')
const canGoBack = ref(false)
const canGoForward = ref(false)
const devtoolsOpen = ref(false)

const activeTab = computed(() => tabKeyFromPath(route.path))
const PANELS = {
  overview: OverviewPanel,
  resources: ResourcesPanel,
  tasks: TasksPanel,
  diagnostics: DiagnosticsPanel,
} as const
const activePanel = computed(() => PANELS[activeTab.value])

const displayUrl = computed(() => sanitizePageUrl(pageUrl.value) || TELEGRAM_DEFAULT_URL)

const menuItems = computed(() => TELEGRAM_CACHE_TABS.map(tab => ({
  value: tab.key as string,
  label: tab.label,
  badge: tab.key === 'resources'
    ? store.resources.length
    : tab.key === 'tasks'
      ? store.activeTasks.length
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
    ElMessage.warning('页面内核尚未就绪，请稍后重试')
    return
  }
  try {
    await store.attachPage(id)
  } catch (error) {
    ElMessage.warning(`页面未绑定：${(error as Error).message}`)
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
    ElMessage.warning((error as Error).message || '无法打开开发者工具')
  }
}

function openInBrowser(): void {
  const url = pageUrl.value || TELEGRAM_DEFAULT_URL
  if (!url) return
  openExternal(url)
}

async function toggleObservation(value: boolean): Promise<void> {
  try {
    await store.setObservationEnabled(value)
    ElMessage.success(value ? '观测已开启' : '观测已暂停（页面行为不受影响）')
  } catch (error) {
    ElMessage.error((error as Error).message || '切换观测失败')
  }
}

function switchTab(key: string): void {
  if (key === activeTab.value) return
  const tab = TELEGRAM_CACHE_TABS.find(item => item.key === key)
  if (tab) router.push({ name: tab.routeName })
}

onMounted(async () => {
  if (!isElectron) return
  try {
    await store.init()
  } catch (error) {
    initError.value = (error as Error).message
  }
})

onUnmounted(() => {
  store.dispose()
})
</script>

<template>
  <div class="tool-page telegram-page">
    <UiToolbar class="topbar" surface bordered padding="var(--spacing-sm) var(--spacing-md)" gap="sm" flush>
      <UiIconButton icon="arrowLeft" label="后退" :disabled="!canGoBack" @click="goBack" />
      <UiIconButton icon="arrowRight" label="前进" :disabled="!canGoForward" @click="goForward" />
      <UiIconButton icon="refresh" label="刷新页面" @click="reload" />
      <span class="url-pill mono" :title="displayUrl">{{ displayUrl }}</span>
      <span v-if="loading" class="loading-dot" aria-label="加载中" />

      <template #end>
        <UiSwitchField :model-value="store.observationEnabled" @update:model-value="toggleObservation">
          观测
        </UiSwitchField>
        <UiIconButton icon="script" label="页面开发者工具" :active="devtoolsOpen" @click="toggleDevTools" />
        <el-button size="small" :disabled="!isElectron" @click="openInBrowser">
          外部打开
        </el-button>
      </template>
    </UiToolbar>

    <div class="page-body">
      <section class="browser-pane">
        <el-alert
          v-if="initError"
          class="pane-alert"
          type="warning"
          :closable="false"
          show-icon
          title="后端未就绪"
          :description="`${initError}。请确认在 everydaytool 桌面端运行（网页预览没有主进程 IPC）。`"
        />
        <el-alert
          v-else-if="!isElectron"
          class="pane-alert"
          type="info"
          :closable="false"
          show-icon
          title="网页预览不支持内嵌 Telegram"
          description="请使用 everydaytool 桌面端打开本工具。"
        />

        <webview
          v-if="isElectron"
          :ref="bindWebview"
          :partition="TELEGRAM_WEBVIEW_PARTITION"
          :src="TELEGRAM_DEFAULT_URL"
          class="telegram-webview"
        />

        <div v-if="loading && !loadError" class="browser-overlay">
          <span class="muted">正在加载 Telegram Web A…</span>
        </div>

        <div v-if="loadError" class="browser-overlay is-error">
          <span class="error-text">{{ loadError }}</span>
          <UiGroup gap="sm">
            <el-button size="small" type="primary" @click="reload">
              重试
            </el-button>
            <el-button size="small" @click="openInBrowser">
              在系统浏览器打开
            </el-button>
          </UiGroup>
        </div>
      </section>

      <aside class="side-pane">
        <UiMenuHorizontal :model-value="activeTab" :items="menuItems" @update:model-value="switchTab" />
        <div class="side-scroll">
          <KeepAlive>
            <component :is="activePanel" />
          </KeepAlive>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped lang="scss">
.telegram-page {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}

.topbar {
  flex-shrink: 0;
  border-bottom: 1px solid var(--color-border-light);
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

.page-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 460px;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
}

.browser-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-raised);
  overflow: hidden;
}

.pane-alert {
  margin: var(--spacing-md);
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

.side-pane {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  min-width: 0;
  min-height: 0;
}

.side-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--spacing-xs) var(--spacing-sm) 0;
}

@media (max-width: 1080px) {
  .page-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(280px, 55%) minmax(0, 1fr);
  }
}
</style>
