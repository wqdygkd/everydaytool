<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { isDesktopEnvironment } from '@/shared/environment'
import { openExternal } from '../api'
import DiagnosticsPanel from '../components/DiagnosticsPanel.vue'
import OverviewPanel from '../components/OverviewPanel.vue'
import ResourcesPanel from '../components/ResourcesPanel.vue'
import TasksPanel from '../components/TasksPanel.vue'
import { TELEGRAM_DEFAULT_URL, TELEGRAM_WEBVIEW_ID, useTelegramPage } from '../composables/useTelegramPage'
import { useTelegramCacheStore } from '../stores/telegramCacheStore'
import { tabKeyFromPath, TELEGRAM_CACHE_TABS } from '../tabs'
import { sanitizePageUrl } from '../utils/format'

const route = useRoute()
const router = useRouter()
const store = useTelegramCacheStore()
const isDesktop = isDesktopEnvironment()

const page = useTelegramPage()
const pageHost = page.host
const initError = ref('')
/** 观测游标：只上报游标之后的新条目，轮询天然幂等 */
let observeCursor = 0

const activeTab = computed(() => tabKeyFromPath(route.path))
const PANELS = {
  overview: OverviewPanel,
  resources: ResourcesPanel,
  tasks: TasksPanel,
  diagnostics: DiagnosticsPanel,
} as const
const activePanel = computed(() => PANELS[activeTab.value])

const displayUrl = computed(() => sanitizePageUrl(page.pageUrl.value) || TELEGRAM_DEFAULT_URL)

const menuItems = computed(() => TELEGRAM_CACHE_TABS.map(tab => ({
  value: tab.key as string,
  label: tab.label,
  badge: tab.key === 'resources'
    ? store.resources.length
    : tab.key === 'tasks'
      ? store.activeTasks.length
      : undefined,
})))

async function attachPage(): Promise<void> {
  try {
    await store.attachPage(TELEGRAM_WEBVIEW_ID)
  } catch (error) {
    ElMessage.warning(`页面未绑定：${(error as Error).message}`)
  }
}

function syncObservation(): void {
  if (!isDesktop) return
  if (store.observationEnabled) {
    page.startObservation(fn => store.reportObservations(fn, () => observeCursor, (cursor) => {
      observeCursor = cursor
    }))
  } else {
    page.stopObservation()
  }
}

function openInBrowser(): void {
  openExternal(page.pageUrl.value || TELEGRAM_DEFAULT_URL)
}

async function toggleObservation(value: boolean): Promise<void> {
  try {
    await store.setObservationEnabled(value)
    syncObservation()
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

// 面板里的「探测页面」也走同一套脚本执行通道
provide('telegramRunScript', page.runScript)

onMounted(async () => {
  if (!isDesktop) return
  try {
    await store.init()
  } catch (error) {
    initError.value = (error as Error).message
  }
  await nextTick()
  await page.ensure()
  await attachPage()
  syncObservation()
})

watch(() => store.observationEnabled, () => syncObservation())

onUnmounted(() => {
  page.stopObservation()
  store.dispose()
})
</script>

<template>
  <div class="tool-page telegram-page">
    <UiToolbar class="topbar" surface bordered padding="var(--spacing-sm) var(--spacing-md)" gap="sm" flush>
      <UiIconButton icon="arrowLeft" label="后退" @click="page.goBack()" />
      <UiIconButton icon="arrowRight" label="前进" @click="page.goForward()" />
      <UiIconButton icon="refresh" label="刷新页面" @click="page.reload()" />
      <span class="url-pill mono" :title="displayUrl">{{ displayUrl }}</span>
      <span v-if="page.loading.value" class="loading-dot" aria-label="加载中" />

      <template #end>
        <UiSwitchField :model-value="store.observationEnabled" @update:model-value="toggleObservation">
          观测
        </UiSwitchField>
        <UiIconButton icon="script" label="页面开发者工具" :active="page.devtoolsOpen.value" @click="page.toggleDevTools()" />
        <el-button size="small" :disabled="!isDesktop" @click="openInBrowser">
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
          :description="`${initError}。请确认在 everydaytool 桌面端运行（网页预览没有桌面桥接）。`"
        />
        <el-alert
          v-else-if="!isDesktop"
          class="pane-alert"
          type="info"
          :closable="false"
          show-icon
          title="网页预览不支持内嵌 Telegram"
          description="请使用 everydaytool 桌面端打开本工具。"
        />

        <!-- 子 Webview 由 Rust 侧按这个宿主的几何摆放；div 本身只占位 -->
        <div v-if="isDesktop" ref="pageHost" class="telegram-webview-host" />

        <div v-if="page.loading.value && !page.loadError.value" class="browser-overlay">
          <span class="muted">正在加载 Telegram Web A…</span>
        </div>

        <div v-if="page.loadError.value" class="browser-overlay is-error">
          <span class="error-text">{{ page.loadError.value }}</span>
          <UiGroup gap="sm">
            <el-button size="small" type="primary" @click="page.reload()">
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

/* 宿主只负责几何：真正的页面画在它上层的 Tauri 子 Webview 里 */
.telegram-webview-host {
  flex: 1;
  width: 100%;
  min-height: 0;
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
