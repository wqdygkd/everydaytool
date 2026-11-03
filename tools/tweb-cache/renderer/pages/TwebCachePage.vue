<script setup lang="ts">
import type { TelegramLibraryEntry, TelegramTrashEntry } from '../../../../shared/telegram-cache'
import type { TwebWebviewTag } from '../webview'
import { isElectronEnvironment } from '@renderer/shared/environment'
import { confirm } from '@renderer/shared/feedback'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { toast } from 'vue-sonner'
import ToolSideInspector from '../../../../renderer/shared/components/workspace/ToolSideInspector.vue'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import WorkspaceHeader from '../../../../renderer/shared/components/workspace/WorkspaceHeader.vue'
import { TWEB_CACHE_WEBVIEW_PARTITION } from '../../../../shared/webview'
import { useTwebCacheStore } from '../stores/twebCacheStore'
import { tabKeyFromPath, TWEB_CACHE_TABS } from '../tabs'
import { formatBytes } from '../utils/format'

const route = useRoute()
const router = useRouter()
const store = useTwebCacheStore()
const isElectron = isElectronEnvironment()

const webviewRef = shallowRef<TwebWebviewTag | null>(null)
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

const originNotice = computed(() => (site.value?.originChanged ? site.value.portNote ?? '' : ''))
const originNoticeDismissed = ref(false)
watch(originNotice, () => {
  originNoticeDismissed.value = false
})

const activeTab = computed(() => tabKeyFromPath(route.path))
const displayUrl = computed(() => pageUrl.value || pageSrc.value || '')
const inspectorTitle = computed(() =>
  TWEB_CACHE_TABS.find(tab => tab.key === activeTab.value)?.label ?? '工具详情',
)
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

const menuItems = computed(() => TWEB_CACHE_TABS.map(tab => ({
  value: tab.key as string,
  label: tab.label,
  badge: tab.key === 'library' ? store.library.length : undefined,
})))

interface LibraryRow extends TelegramLibraryEntry {
  groupTitle: string
  groupSize: number
}

const groupedLibrary = computed<LibraryRow[]>(() => {
  const groups = new Map<string, TelegramLibraryEntry[]>()
  for (const entry of store.library) {
    const key = `${entry.peerId}:${entry.groupedId ?? `single-${entry.messageId}`}`
    const group = groups.get(key)
    if (group) group.push(entry)
    else groups.set(key, [entry])
  }

  const rows: LibraryRow[] = []
  for (const entries of groups.values()) {
    const first = entries[0]
    const title = first.peerTitle || first.peerId
    entries.forEach((entry) => {
      rows.push({
        ...entry,
        groupTitle: title,
        groupSize: entries.length,
      })
    })
  }
  return rows
})

function safeCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function syncNavigation(wv: TwebWebviewTag): void {
  canGoBack.value = safeCall(() => wv.canGoBack(), false)
  canGoForward.value = safeCall(() => wv.canGoForward(), false)
  devtoolsOpen.value = safeCall(() => wv.isDevToolsOpened(), false)
}

function bindWebview(el: unknown): void {
  if (!el) return
  const wv = el as TwebWebviewTag
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
    void refreshMediaCache(true)
    if (activeTab.value === 'library') void backfillThumbnails()
  })
  wv.addEventListener('did-navigate', (event) => {
    pageUrl.value = (event as { url?: string }).url || pageUrl.value
    loadError.value = ''
    syncNavigation(wv)
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
    toast.warning((error as Error).message || '无法打开开发者工具')
  }
}

function openInBrowser(): void {
  const url = pageUrl.value || pageSrc.value
  if (!url) return
  openExternal(url)
}

// —— tweb 媒体缓存（页面侧 Cache Storage：整文件 / 流式分块 / HLS）——
// tweb 默认按 TTL 自动清理（默认 7 天）；edt 客户端已在页面内把 TTL 关掉，这里只提供用量与手动清理。
type MediaCacheBucket = 'cachedFiles' | 'cachedStreamChunks' | 'cachedHlsQualityFiles' | 'cachedHlsStreamChunks'
interface MediaCacheUsage { total: number, buckets: Record<string, number> }

const MEDIA_CACHE_BUCKETS: readonly MediaCacheBucket[] = ['cachedFiles', 'cachedStreamChunks', 'cachedHlsQualityFiles', 'cachedHlsStreamChunks']
const MEDIA_CACHE_LABELS: Record<string, string> = {
  cachedFiles: '整文件',
  cachedStreamChunks: '流式分块',
  cachedHlsQualityFiles: 'HLS 画质',
  cachedHlsStreamChunks: 'HLS 分块',
}

const mediaCacheUsage = ref<MediaCacheUsage | null>(null)
const mediaCacheLoading = ref(false)
const mediaCacheClearing = ref(false)
const mediaCacheBusy = ref(false)
const thumbnailBackfillRunning = ref(false)
let mediaCacheTimer: number | undefined

async function runMediaCacheBridge<T>(script: string): Promise<T | null> {
  const wv = webviewRef.value
  if (!wv) return null
  try {
    return (await wv.executeJavaScript(script, true)) as T | null
  } catch {
    return null
  }
}

async function refreshMediaCache(silent = false): Promise<void> {
  if (mediaCacheBusy.value || !isElectron) return
  mediaCacheBusy.value = true
  if (!silent) mediaCacheLoading.value = true
  try {
    const result = await runMediaCacheBridge<MediaCacheUsage>(`(async () => {
      const names = ${JSON.stringify(MEDIA_CACHE_BUCKETS)};
      const buckets = {};
      let total = 0;
      for (const name of names) {
        try {
          const cache = await caches.open(name);
          const responses = await cache.matchAll();
          let size = 0;
          for (const response of responses) {
            const len = parseInt(response.headers.get('content-length') || '0', 10);
            size += Number.isFinite(len) ? len : 0;
          }
          buckets[name] = size;
          total += size;
        } catch (e) { buckets[name] = -1; }
      }
      return { total, buckets };
    })()`)
    if (result) mediaCacheUsage.value = result
  } finally {
    mediaCacheBusy.value = false
    if (!silent) mediaCacheLoading.value = false
  }
}

async function clearMediaCache(): Promise<void> {
  if (mediaCacheClearing.value || !isElectron) return
  try {
    await confirm(
      '将删除 tweb 页面里已缓存的媒体字节（整文件与流式分块）。清理后重新查看 / 播放会重新从 Telegram 下载。继续？',
      '清理 tweb 媒体缓存',
      { type: 'warning', confirmButtonText: '清理', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  mediaCacheClearing.value = true
  try {
    const cleared = await runMediaCacheBridge<number>(`(async () => {
      const names = ${JSON.stringify(MEDIA_CACHE_BUCKETS)};
      let cleared = 0;
      for (const name of names) {
        try {
          const cache = await caches.open(name);
          const requests = await cache.keys();
          for (const request of requests) await cache.delete(request);
          cleared += 1;
        } catch (e) {}
      }
      return cleared;
    })()`)
    if (typeof cleared === 'number') {
      toast.success(`已清理 ${cleared} 个媒体缓存桶`)
      void refreshMediaCache()
    } else {
      toast.warning('tweb 页面尚未就绪，无法清理')
    }
  } finally {
    mediaCacheClearing.value = false
  }
}

const mediaCacheBreakdown = computed(() => {
  const usage = mediaCacheUsage.value
  if (!usage) return '—'
  return MEDIA_CACHE_BUCKETS
    .map(name => `${MEDIA_CACHE_LABELS[name] ?? name} ${formatBytes(usage.buckets[name] ?? 0)}`)
    .join(' · ')
})

watch(() => store.siteReady, (ready) => {
  if (ready) void refreshMediaCache(true)
}, { immediate: true })

function startMediaCacheAutoRefresh(): void {
  if (mediaCacheTimer !== undefined || !isElectron) return
  mediaCacheTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && inspectorOpen.value && activeTab.value === 'overview') {
      void refreshMediaCache(true)
    }
  }, 5000)
}

watch(activeTab, (tab) => {
  if (tab !== 'overview') inspectorOpen.value = true
  if (inspectorOpen.value && tab === 'overview') void refreshMediaCache(true)
})

async function backfillThumbnails(): Promise<void> {
  if (thumbnailBackfillRunning.value || !isElectron) return
  const requests = store.library
    .filter(entry => entry.state === 'complete' && !entry.thumbnailUrl)
    .map(entry => ({ peerId: entry.peerId, messageId: entry.messageId }))
  if (!requests.length) return

  thumbnailBackfillRunning.value = true
  try {
    const result = await runMediaCacheBridge<{ saved: number, failed: number }>(`
      (() => {
        const fn = window.__EDT_BACKFILL_THUMBNAILS__;
        return typeof fn === 'function' ? fn(${JSON.stringify(requests)}) : null;
      })()
    `)
    if (result?.saved) {
      toast.success(`已补齐 ${result.saved} 个缩略图`)
      await store.loadLibrary(true)
    }
  } finally {
    thumbnailBackfillRunning.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'library') void backfillThumbnails()
})

/** 影库定位：调 tweb 页面里挂的 window.__EDT_JUMP_TO_MESSAGE__ */
async function runJump(jump: { peerId: string, messageId: number }): Promise<void> {
  const wv = webviewRef.value
  if (!wv) {
    toast.warning('tweb 页面尚未就绪')
    return
  }
  if (!/^-?\d{1,20}$/.test(jump.peerId) || !Number.isSafeInteger(jump.messageId)) return

  const script = '(() => {'
    + 'const fn = window.__EDT_JUMP_TO_MESSAGE__;'
    + `return typeof fn === 'function' ? fn(${JSON.stringify(jump.peerId)}, ${jump.messageId}) : false;`
    + '})()'
  try {
    const jumped = await wv.executeJavaScript(script, true)
    if (!jumped) toast.warning('该会话还没有在 tweb 里加载，请先在左侧打开它')
  } catch (error) {
    toast.error(`跳转失败：${(error as Error).message}`)
  }
}

watch(() => store.pendingJump, () => {
  const jump = store.consumeJump()
  if (jump) void runJump(jump)
})

function switchTab(key: string): void {
  if (key === activeTab.value) return
  const tab = TWEB_CACHE_TABS.find(item => item.key === key)
  if (tab) {
    inspectorOpen.value = true
    router.push({ name: tab.routeName })
  }
}

function openInspector(): void {
  inspectorOpen.value = true
  if (activeTab.value === 'overview') void refreshMediaCache(true)
}

async function openDir(entry: TelegramLibraryEntry): Promise<void> {
  try {
    await store.openMessageDir(entry.peerId, entry.messageId)
  } catch (error) {
    toast.error((error as Error).message || '打开目录失败')
  }
}

function jumpToEntry(entry: TelegramLibraryEntry): void {
  store.requestJump(entry.peerId, entry.messageId)
}

async function removeEntry(entry: TelegramLibraryEntry): Promise<void> {
  try {
    await confirm(
      `把消息 ${entry.messageId} 移入回收站？原目录与 manifest 会保留，可在回收站恢复。`,
      '移入回收站',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    if (webviewRef.value) {
      const script = '(() => {'
        + 'const fn = window.__EDT_CANCEL_ARCHIVE__;'
        + `return typeof fn === 'function' ? fn(${JSON.stringify(entry.peerId)}, ${entry.messageId}) : false;`
        + '})()'
      try {
        await webviewRef.value.executeJavaScript(script, true)
      } catch {}
    }
    await store.deleteMessage(entry.peerId, entry.messageId)
    toast.success('已移入回收站')
  } catch (error) {
    toast.error((error as Error).message || '移入回收站失败')
  }
}

async function restoreTrash(entry: TelegramTrashEntry): Promise<void> {
  try {
    await store.restoreTrash(entry.trashId)
    toast.success('已恢复')
  } catch (error) {
    toast.error((error as Error).message || '恢复失败')
  }
}

async function refreshAll(): Promise<void> {
  try {
    await Promise.all([
      store.refreshSite(),
      store.loadLibrary(),
      store.loadTrash(),
      refreshMediaCache(true),
    ])
  } catch (error) {
    toast.error((error as Error).message || '刷新失败')
  }
}

async function openDataDir(): Promise<void> {
  try {
    await store.openDataDir()
  } catch (error) {
    toast.error((error as Error).message || '打开数据目录失败')
  }
}

/** UiTableColumn 插槽行是宽泛记录类型；先收敛到业务类型再使用。 */
function toEntry(row: unknown): TelegramLibraryEntry {
  return row as TelegramLibraryEntry
}

function toTrash(row: unknown): TelegramTrashEntry {
  return row as TelegramTrashEntry
}

function progressOf(entry: TelegramLibraryEntry): number {
  if (entry.state === 'complete') return 100
  return Math.round(Math.min(1, Math.max(0, entry.progress ?? 0)) * 100)
}

function stateLabel(entry: TelegramLibraryEntry): string {
  switch (entry.state) {
    case 'complete': return '已缓存'
    case 'partial':
    case 'downloading': return '缓存中'
    case 'queued': return '排队中'
    case 'failed': return '失败'
    default: return '缺失'
  }
}

function stateTone(entry: TelegramLibraryEntry): 'success' | 'warning' | 'primary' | 'danger' | 'neutral' {
  switch (entry.state) {
    case 'complete': return 'success'
    case 'partial':
    case 'downloading': return 'warning'
    case 'queued': return 'primary'
    case 'failed': return 'danger'
    default: return 'neutral'
  }
}

onMounted(async () => {
  if (activeTab.value !== 'overview') inspectorOpen.value = true
  if (!isElectron) return
  try {
    await store.init()
  } catch (error) {
    initError.value = (error as Error).message
  }
  startMediaCacheAutoRefresh()
  void store.normalizeLibrary().catch(() => undefined)
})

onUnmounted(() => {
  if (mediaCacheTimer !== undefined) {
    window.clearInterval(mediaCacheTimer)
    mediaCacheTimer = undefined
  }
  const wv = webviewRef.value
  if (wv && devtoolsOpen.value) safeCall(() => wv.closeDevTools(), undefined)
  webviewRef.value = null
  store.dispose()
})
</script>

<template>
  <div class="tool-page tweb-page">
    <WorkspaceHeader
      icon="telegram"
      title="Telegram 缓存（tweb）"
      description="内嵌 tweb 页面，按需查看归档、回收站与页面媒体缓存"
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
      <ToolSurface class="tweb-surface">
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
            title="网页预览不支持内嵌 tweb"
            description="请使用 everydaytool 桌面端打开本工具。"
          />
          <UiAlert
            v-else-if="!pageSrc"
            class="pane-alert"
            type="warning"
            :closable="false"
            show-icon
            title="tweb 本地站点未就绪"
            :description="siteError || '正在启动本地站点…（首次需要先在 tweb/ 里构建 dist）'"
          />
          <UiAlert
            v-else-if="originNotice && !originNoticeDismissed"
            class="pane-alert"
            type="warning"
            show-icon
            title="站点端口已变化：tweb 登录态已重置"
            :description="originNotice"
            @close="originNoticeDismissed = true"
          />

          <webview
            v-if="isElectron && pageSrc"
            :ref="bindWebview"
            :partition="TWEB_CACHE_WEBVIEW_PARTITION"
            :src="pageSrc"
            class="tweb-webview"
          />

          <div v-if="loading && pageSrc && !loadError" class="browser-overlay">
            <span class="muted">正在加载 tweb…</span>
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
          <span>TWEB LOCAL</span>
          <span v-if="store.site?.port" class="mono">PORT {{ store.site.port }}</span>
          <span>{{ store.library.length }} 条归档</span>
          <span v-if="mediaCacheUsage">媒体缓存 {{ formatBytes(mediaCacheUsage.total) }}</span>
          <span class="status-spacer" />
          <span>{{ inspectorOpen ? 'INSPECTOR ON' : 'WEBVIEW ONLY' }}</span>
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
          <UiMenuHorizontal :model-value="activeTab" :items="menuItems" @update:model-value="switchTab" />
          <div class="side-scroll">
            <div v-if="activeTab === 'overview'" class="inspector-sections">
              <section class="inspector-section">
                <header class="inspector-section-head">
                  <div>
                    <strong>本地站点</strong>
                    <span>tweb 独立回环端口</span>
                  </div>
                  <UiChip :tone="store.siteReady ? 'success' : 'neutral'" mono>
                    {{ store.siteReady ? '已就绪' : '未就绪' }}
                  </UiChip>
                </header>
                <UiDetailGrid :columns="2">
                  <UiDetailItem label="页面地址" size="xs" mono>
                    {{ store.site?.url || '—' }}
                  </UiDetailItem>
                  <UiDetailItem label="端口" size="xs" mono>
                    {{ store.site?.port ?? '—' }}
                  </UiDetailItem>
                  <UiDetailItem label="origin" size="xs">
                    {{ store.site?.originChanged ? '本次已变化' : '已固定' }}
                  </UiDetailItem>
                  <UiDetailItem label="进行中归档" size="xs" mono>
                    {{ store.pendingArchives.length }}
                  </UiDetailItem>
                </UiDetailGrid>
                <UiHint v-if="store.site?.error" block class="danger-hint">
                  {{ store.site.error }}
                </UiHint>
                <UiHint v-else block>
                  页面由工具自己的回环端口托管；归档 API 与媒体流由平台归档引擎提供。
                </UiHint>
                <div class="inspector-actions">
                  <UiButton size="small" @click="openDataDir">
                    打开数据目录
                  </UiButton>
                  <UiButton size="small" :loading="store.busy.library" @click="refreshAll">
                    刷新
                  </UiButton>
                </div>
              </section>

              <section class="inspector-section">
                <header class="inspector-section-head">
                  <div>
                    <strong>本地归档</strong>
                    <span>独立命名空间，不与其他工具互相覆盖</span>
                  </div>
                </header>
                <UiDetailGrid :columns="2">
                  <UiDetailItem label="已缓存消息" size="xs" mono>
                    {{ store.library.filter(item => item.state === 'complete').length }} 条
                  </UiDetailItem>
                  <UiDetailItem label="进行中" size="xs" mono>
                    {{ store.pendingArchives.length }} 条
                  </UiDetailItem>
                </UiDetailGrid>
                <UiHint block>
                  assets/tweb-cache/ 与 assets/telegram-cache/ 各自存档，存储代码共用。
                </UiHint>
              </section>

              <section class="inspector-section">
                <header class="inspector-section-head">
                  <div>
                    <strong>tweb 媒体缓存</strong>
                    <span>浏览器 Cache Storage</span>
                  </div>
                </header>
                <UiDetailGrid :columns="2">
                  <UiDetailItem label="占用" size="xs" mono>
                    {{ mediaCacheUsage ? formatBytes(mediaCacheUsage.total) : '—' }}
                  </UiDetailItem>
                  <UiDetailItem label="自动清理" size="xs">
                    已关闭（手动清）
                  </UiDetailItem>
                </UiDetailGrid>
                <UiHint block>
                  {{ mediaCacheBreakdown }}
                </UiHint>
                <div class="inspector-actions">
                  <UiButton size="small" :loading="mediaCacheLoading" @click="refreshMediaCache()">
                    刷新用量
                  </UiButton>
                  <UiButton size="small" type="danger" plain :loading="mediaCacheClearing" @click="clearMediaCache">
                    清理
                  </UiButton>
                </div>
              </section>
            </div>

            <div v-else class="inspector-sections">
              <section class="inspector-section inspector-section--fill">
                <header class="inspector-section-head">
                  <div>
                    <strong>本地影库</strong>
                    <span>{{ store.library.length }} 条记录</span>
                  </div>
                  <UiButton size="small" :loading="store.busy.library" @click="refreshAll">
                    刷新
                  </UiButton>
                </header>
                <UiTable
                  :data="groupedLibrary"
                  max-height="320"
                  empty-text="还没有本地缓存：先在 tweb 页面里右键「缓存此消息」"
                >
                  <UiTableColumn label="会话 / 消息" min-width="146">
                    <template #default="{ row }">
                      <div class="library-main">
                        <img
                          v-if="row.thumbnailUrl"
                          class="library-thumb"
                          :src="row.thumbnailUrl"
                          loading="lazy"
                          alt=""
                        >
                        <span class="library-message">
                          <span class="mono library-title">{{ row.groupTitle }}</span>
                          <span class="muted">
                            #{{ row.messageId }} · {{ formatBytes(row.size) }}
                            <template v-if="row.groupSize > 1"> · 组内 {{ row.groupSize }} 条</template>
                          </span>
                        </span>
                      </div>
                    </template>
                  </UiTableColumn>
                  <UiTableColumn label="状态" width="78">
                    <template #default="{ row }">
                      <div class="state-cell">
                        <UiChip :tone="stateTone(toEntry(row))">
                          {{ stateLabel(toEntry(row)) }}
                        </UiChip>
                        <UiProgress
                          v-if="toEntry(row).state !== 'complete'"
                          :percentage="progressOf(toEntry(row))"
                          :stroke-width="3"
                        />
                      </div>
                    </template>
                  </UiTableColumn>
                  <UiTableColumn label="操作" width="92" align="right">
                    <template #default="{ row }">
                      <div class="row-actions">
                        <UiIconButton
                          icon="arrowRight"
                          :size="24"
                          label="定位消息"
                          @click="jumpToEntry(toEntry(row))"
                        />
                        <UiIconButton
                          icon="external"
                          :size="24"
                          label="打开文件夹"
                          @click="openDir(toEntry(row))"
                        />
                        <UiIconButton
                          icon="trash"
                          :size="24"
                          label="移入回收站"
                          @click="removeEntry(toEntry(row))"
                        />
                      </div>
                    </template>
                  </UiTableColumn>
                </UiTable>
              </section>

              <section class="inspector-section">
                <header class="inspector-section-head">
                  <div>
                    <strong>回收站</strong>
                    <span>{{ store.trash.length }} 条记录</span>
                  </div>
                </header>
                <UiTable :data="store.trash" max-height="180" empty-text="回收站为空">
                  <UiTableColumn label="会话 / 消息" min-width="180" show-overflow-tooltip>
                    <template #default="{ row }">
                      <span class="mono">{{ row.peerId }} / {{ row.messageId }}</span>
                    </template>
                  </UiTableColumn>
                  <UiTableColumn label="操作" width="72" align="right">
                    <template #default="{ row }">
                      <UiButton size="small" text type="primary" @click="restoreTrash(toTrash(row))">
                        恢复
                      </UiButton>
                    </template>
                  </UiTableColumn>
                </UiTable>
              </section>
            </div>
          </div>
        </div>
      </ToolSideInspector>
    </div>
  </div>
</template>

<style scoped lang="scss">
.tweb-page {
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

.tweb-surface {
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
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
  animation: tweb-pulse 1.2s ease-in-out infinite;
}

@keyframes tweb-pulse {
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

.tweb-webview {
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

.inspector-section--fill {
  min-height: 0;
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

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacing-xs);
}

.library-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.library-thumb {
  flex: none;
  width: 34px;
  height: 34px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  background: var(--color-fill);
}

.library-message {
  display: grid;
  min-width: 0;
  line-height: 1.35;

  > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.library-title {
  color: var(--color-text-primary);
}

.state-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--spacing-xs);

  :deep(.ui-progress) {
    width: 100%;
  }
}

.danger-hint {
  color: var(--color-warning);
}

.status-spacer {
  flex: 1;
}

@media (prefers-reduced-motion: reduce) {
  .loading-dot {
    animation: none;
  }
}
</style>
