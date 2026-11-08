<script setup lang="ts">
import type { ArchiveLibraryEntry, ArchiveTrashEntry } from '../../../../shared/media-archive'
import type { TwebWebviewTag } from '../webview'
import { useToolPath } from '@renderer/shared/composables/useToolPath'
import { isElectronEnvironment } from '@renderer/shared/environment'
import { confirm } from '@renderer/shared/feedback'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { toast } from 'vue-sonner'
import ToolSideInspector from '../../../../renderer/shared/components/workspace/ToolSideInspector.vue'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import { TWEB_CACHE_WEBVIEW_PARTITION } from '../../../../shared/webview'
import { useTwebCacheStore } from '../stores/twebCacheStore'
import { tabKeyFromPath, TWEB_CACHE_TABS } from '../tabs'
import { formatBytes } from '../utils/format'

const router = useRouter()
const store = useTwebCacheStore()
const isElectron = isElectronEnvironment()
const toolPath = useToolPath()

const INSPECTOR_PREF_STORAGE_KEY = 'twebCache.inspector'
const INSPECTOR_DEFAULT_WIDTH = 360
const INSPECTOR_MIN_WIDTH = 320
const INSPECTOR_MAX_WIDTH = 720

interface InspectorPreference {
  open?: boolean
  width?: number
}

function readInspectorPreference(): InspectorPreference {
  try {
    const raw = localStorage.getItem(INSPECTOR_PREF_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { open?: unknown, width?: unknown }
    const width = typeof parsed.width === 'number' && Number.isFinite(parsed.width)
      ? Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, Math.round(parsed.width)))
      : undefined
    return {
      open: typeof parsed.open === 'boolean' ? parsed.open : undefined,
      width,
    }
  } catch {
    return {}
  }
}

const activeTab = computed(() => tabKeyFromPath(toolPath.value))
const inspectorPreference = readInspectorPreference()

const webviewRef = shallowRef<TwebWebviewTag | null>(null)
const boundElements = new WeakSet<object>()
const pageUrl = ref('')
const loading = ref(true)
const loadError = ref('')
const initError = ref('')
const canGoBack = ref(false)
const canGoForward = ref(false)
const devtoolsOpen = ref(false)
const inspectorOpen = ref(inspectorPreference.open ?? activeTab.value !== 'overview')
const inspectorWidth = ref(inspectorPreference.width ?? INSPECTOR_DEFAULT_WIDTH)

const site = computed(() => store.site)
const pageSrc = computed(() => site.value?.url ?? '')
const siteError = computed(() => site.value?.error ?? '')

const originNotice = computed(() => (site.value?.originChanged ? site.value.portNote ?? '' : ''))
const originNoticeDismissed = ref(false)
watch(originNotice, () => {
  originNoticeDismissed.value = false
})

const displayUrl = computed(() => pageUrl.value || pageSrc.value || '')
const inspectorTitle = computed(() =>
  TWEB_CACHE_TABS.find(tab => tab.key === activeTab.value)?.label ?? '工具详情',
)
const menuItems = computed(() => TWEB_CACHE_TABS.map(tab => ({
  value: tab.key as string,
  label: tab.label,
  badge: tab.key === 'library' ? store.library.length : undefined,
})))

interface LibraryRow extends ArchiveLibraryEntry {
  groupTitle: string
  groupSize: number
  /** 组内首行 = 组大小；其余行 = 0（被上面的单元格合并掉） */
  groupSpan: number
}

const groupedLibrary = computed<LibraryRow[]>(() => {
  const groups = new Map<string, ArchiveLibraryEntry[]>()
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
    entries.forEach((entry, index) => {
      rows.push({
        ...entry,
        groupTitle: title,
        groupSize: entries.length,
        groupSpan: index === 0 ? entries.length : 0,
      })
    })
  }
  return rows
})

/** 会话 / 消息列按组纵向合并；其他列不合并 */
function librarySpanMethod({ row, columnIndex }: {
  row: Record<PropertyKey, any>
  rowIndex: number
  columnIndex: number
}): [number, number] | undefined {
  if (columnIndex !== 0) return undefined
  const span = Number(row.groupSpan ?? 1)
  if (span > 1) return [span, 1]
  return span === 0 ? [0, 1] : undefined
}

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
const pausingAll = ref(false)
const hasActiveCache = computed(() => store.library.some(entry => entry.state === 'downloading'))
const documentVisibility = useDocumentVisibility()
const mediaCacheAutoRefresh = useIntervalFn(() => {
  if (documentVisibility.value === 'visible' && inspectorOpen.value && activeTab.value === 'overview') {
    void refreshMediaCache(true)
  }
}, 5000, { immediate: false })

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
  if (!isElectron || mediaCacheAutoRefresh.isActive.value) return
  mediaCacheAutoRefresh.resume()
}

watch(activeTab, (tab) => {
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

/** 影库「继续缓存」：调 tweb 页面里挂的 window.__EDT_RESUME_CACHE__（从 .part 续传） */
async function resumeEntry(entry: ArchiveLibraryEntry): Promise<void> {
  const wv = webviewRef.value
  if (!wv) {
    toast.warning('tweb 页面尚未就绪')
    return
  }
  if (!/^-?\d{1,20}$/.test(entry.peerId) || !Number.isSafeInteger(entry.messageId)) return

  const script = '(() => {'
    + 'const fn = window.__EDT_RESUME_CACHE__;'
    + `return typeof fn === 'function' ? fn(${JSON.stringify(entry.peerId)}, ${entry.messageId}) : null;`
    + '})()'
  try {
    const result = await wv.executeJavaScript(script, true) as { started?: boolean, reason?: string } | null
    if (!result) {
      toast.warning('tweb 页面未启用归档客户端')
      return
    }
    if (!result.started) {
      toast.warning(result.reason === 'busy' ? '这条消息正在缓存' : '该消息还没有在 tweb 里加载，请先打开对应会话')
      return
    }
    toast.success('已开始继续缓存')
  } catch (error) {
    toast.error(`继续缓存失败：${(error as Error).message}`)
  }
}

/** 暂停影库 → 页面的全部缓存任务：只中断，`.part` 保留，之后可继续缓存 */
async function pauseAllCaches(): Promise<void> {
  const wv = webviewRef.value
  if (!wv) {
    toast.warning('tweb 页面尚未就绪')
    return
  }
  pausingAll.value = true
  try {
    const paused = await wv.executeJavaScript(
      '(() => { const fn = window.__EDT_PAUSE_ALL_ARCHIVE__; return typeof fn === \'function\' ? fn() : null; })()',
      true,
    ) as number | null
    if (paused === null) {
      toast.warning('tweb 页面未启用归档客户端')
      return
    }
    store.clearActiveArchives()
    // 等 abort 落到 catch（状态改回 partial）再重扫，避免刚暂停又读回「缓存中」
    await new Promise(resolve => window.setTimeout(resolve, 300))
    await store.loadLibrary(true)
    toast.success(paused > 0 ? `已暂停 ${paused} 个缓存任务` : '没有正在进行的缓存任务')
  } catch (error) {
    toast.error(`暂停失败：${(error as Error).message}`)
  } finally {
    pausingAll.value = false
  }
}

function switchTab(key: string): void {
  if (key === activeTab.value) return
  const tab = TWEB_CACHE_TABS.find(item => item.key === key)
  if (tab) {
    setInspectorOpen(true)
    router.push({ name: tab.routeName })
  }
}

function openInspector(): void {
  setInspectorOpen(true)
  if (activeTab.value === 'overview') void refreshMediaCache(true)
}

function closeInspector(): void {
  setInspectorOpen(false)
}

function setInspectorOpen(open: boolean): void {
  inspectorOpen.value = open
  writeInspectorPreference()
}

function setInspectorWidth(width: number): void {
  inspectorWidth.value = width
}

function finishInspectorResize(width: number): void {
  inspectorWidth.value = width
  writeInspectorPreference()
}

function writeInspectorPreference(): void {
  try {
    localStorage.setItem(INSPECTOR_PREF_STORAGE_KEY, JSON.stringify({
      open: inspectorOpen.value,
      width: inspectorWidth.value,
    }))
  } catch {}
}

async function openDir(entry: ArchiveLibraryEntry): Promise<void> {
  try {
    await store.openMessageDir(entry.peerId, entry.messageId)
  } catch (error) {
    toast.error((error as Error).message || '打开目录失败')
  }
}

function jumpToEntry(entry: ArchiveLibraryEntry): void {
  store.requestJump(entry.peerId, entry.messageId)
}

async function removeEntry(entry: ArchiveLibraryEntry): Promise<void> {
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

async function restoreTrash(entry: ArchiveTrashEntry): Promise<void> {
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
      store.loadArchiveDirInfo(),
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
    toast.error((error as Error).message || '打开归档目录失败')
  }
}

async function selectArchiveDir(): Promise<void> {
  let directory: string | null = null
  try {
    directory = await store.selectArchiveDir()
  } catch (error) {
    toast.error((error as Error).message || '选择归档目录失败')
    return
  }
  if (!directory) return
  if (store.archiveDir && directory === store.archiveDir.archiveDir) return

  try {
    await confirm(
      `把 Telegram 归档切换到：\n${directory}\n\n现有的 messages/ 与 trash/ 会整体迁移；`
      + '索引留在数据目录，迁移完成后影库立即指向新位置。',
      '自定义归档目录',
      { type: 'warning', confirmButtonText: '迁移并切换', cancelButtonText: '取消' },
    )
  } catch {
    return
  }

  try {
    const result = await store.changeArchiveDir(directory)
    toast.success(result.changed ? `归档目录已切换，迁移 ${result.moved.length} 项` : '归档目录未变化')
  } catch (error) {
    toast.error((error as Error).message || '切换归档目录失败')
  }
}

async function resetArchiveDir(): Promise<void> {
  const info = store.archiveDir
  if (!info?.isCustom) return
  try {
    await confirm(
      `恢复默认归档目录：\n${info.defaultArchiveDir}\n\n`
      + '当前的 messages/ 与 trash/ 会迁回该目录；目标里已有同名非空目录时不会覆盖。',
      '恢复默认归档目录',
      { type: 'warning', confirmButtonText: '恢复默认', cancelButtonText: '取消' },
    )
  } catch {
    return
  }

  try {
    const result = await store.changeArchiveDir(null)
    toast.success(result.changed ? '已恢复默认归档目录' : '归档目录未变化')
  } catch (error) {
    toast.error((error as Error).message || '恢复默认归档目录失败')
  }
}

/** UiTableColumn 插槽行是宽泛记录类型；先收敛到业务类型再使用。 */
function toEntry(row: unknown): ArchiveLibraryEntry {
  return row as ArchiveLibraryEntry
}

function toTrash(row: unknown): ArchiveTrashEntry {
  return row as ArchiveTrashEntry
}

function progressOf(entry: ArchiveLibraryEntry): number {
  if (entry.state === 'complete') return 100
  return Math.round(Math.min(1, Math.max(0, entry.progress ?? 0)) * 100)
}

function stateLabel(entry: ArchiveLibraryEntry): string {
  switch (entry.state) {
    case 'complete': return '已缓存'
    // partial 是「未完成」（含上次中断），只有 downloading 才是本进程正在写盘
    case 'partial': return '部分缓存'
    case 'downloading': return '缓存中'
    case 'queued': return '排队中'
    case 'failed': return '失败'
    default: return '缺失'
  }
}

function stateTone(entry: ArchiveLibraryEntry): 'success' | 'warning' | 'primary' | 'danger' | 'neutral' {
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
  const wv = webviewRef.value
  if (wv && devtoolsOpen.value) safeCall(() => wv.closeDevTools(), undefined)
  webviewRef.value = null
  writeInspectorPreference()
  store.dispose()
})
</script>

<template>
  <div class="tool-page tweb-page">
    <div class="embedded-stage">
      <ToolSurface class="tweb-surface">
        <template #toolbar>
          <UiToolbar class="tweb-toolbar" gap="sm" flush>
            <UiIconButton icon="arrowLeft" label="后退" :disabled="!canGoBack" @click="goBack" />
            <UiIconButton icon="arrowRight" label="前进" :disabled="!canGoForward" @click="goForward" />
            <UiIconButton icon="refresh" label="刷新页面" @click="reload" />
            <span class="url-pill mono" :title="displayUrl">{{ displayUrl }}</span>
            <span v-if="loading" class="loading-dot" aria-label="加载中" />

            <template #end>
              <UiIconButton
                icon="external"
                label="外部打开"
                :disabled="!displayUrl"
                @click="openInBrowser"
              />
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
      </ToolSurface>

      <ToolSideInspector
        :open="inspectorOpen"
        :title="inspectorTitle"
        :width="inspectorWidth"
        resizable
        :min-width="INSPECTOR_MIN_WIDTH"
        :max-width="INSPECTOR_MAX_WIDTH"
        body-padding="12px"
        @update:width="setInspectorWidth"
        @resize-end="finishInspectorResize"
        @close="closeInspector"
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
                <div class="archive-dir-row">
                  <span class="archive-dir-path mono" :title="store.archiveDir?.archiveDir">
                    {{ store.archiveDir?.archiveDir || '—' }}
                  </span>
                  <UiChip :tone="store.archiveDir?.isCustom ? 'primary' : 'neutral'">
                    {{ store.archiveDir?.isCustom ? '自定义' : '默认' }}
                  </UiChip>
                </div>
                <div class="inspector-actions">
                  <UiButton size="small" @click="openDataDir">
                    打开归档目录
                  </UiButton>
                  <UiButton size="small" :loading="store.busy.archiveDir" @click="selectArchiveDir">
                    更改…
                  </UiButton>
                  <UiButton
                    v-if="store.archiveDir?.isCustom"
                    size="small"
                    :loading="store.busy.archiveDir"
                    @click="resetArchiveDir"
                  >
                    恢复默认
                  </UiButton>
                </div>
                <UiHint block>
                  <template v-if="store.archiveDir?.isCustom">
                    已单独指定归档目录，不影响全局资产目录；索引仍在数据目录，迁移失败会自动回滚。
                  </template>
                  <template v-else>
                    默认保存在 assets/tweb-cache/，与页面登录态分开；可单独指定到其他磁盘。
                  </template>
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
                  <div class="head-actions">
                    <UiButton
                      size="small"
                      :disabled="!hasActiveCache"
                      :loading="pausingAll"
                      @click="pauseAllCaches"
                    >
                      全部暂停
                    </UiButton>
                    <UiButton size="small" :loading="store.busy.library" @click="refreshAll">
                      刷新
                    </UiButton>
                  </div>
                </header>
                <UiTable
                  :data="groupedLibrary"
                  :span-method="librarySpanMethod"
                  max-height="min(560px, calc(100vh - 300px))"
                  empty-text="还没有本地缓存：先在 tweb 页面里右键「缓存此消息」"
                >
                  <UiTableColumn label="会话 / 消息" min-width="96">
                    <template #default="{ row }">
                      <span class="library-group">
                        <span class="mono library-title" :title="row.groupTitle">{{ row.groupTitle }}</span>
                        <span v-if="row.groupSize > 1" class="muted">相册 · {{ row.groupSize }} 条</span>
                      </span>
                    </template>
                  </UiTableColumn>
                  <UiTableColumn label="消息 ID" width="64" align="right">
                    <template #default="{ row }">
                      <span class="mono">{{ row.messageId }}</span>
                    </template>
                  </UiTableColumn>
                  <UiTableColumn label="预览" width="60">
                    <template #default="{ row }">
                      <img
                        v-if="row.thumbnailUrl"
                        class="library-thumb"
                        :src="row.thumbnailUrl"
                        loading="lazy"
                        alt=""
                      >
                      <span v-else class="library-thumb library-thumb--empty">
                        <UiIcon name="layers" :size="14" />
                      </span>
                    </template>
                  </UiTableColumn>
                  <UiTableColumn label="大小" width="80" align="right">
                    <template #default="{ row }">
                      <span class="mono">{{ formatBytes(row.size) }}</span>
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
                  <UiTableColumn label="操作" width="124" align="right">
                    <template #default="{ row }">
                      <div class="row-actions">
                        <UiIconButton
                          v-if="toEntry(row).state !== 'complete'"
                          icon="download"
                          :size="24"
                          label="继续缓存"
                          @click="resumeEntry(toEntry(row))"
                        />
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
  padding: 18px;
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

/* 让 `#end` 真正贴到工具栏最右边（否则 UiToolbar 只按内容宽度收缩，右侧留空） */
.tweb-toolbar {
  flex: 1;
  min-width: 0;
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

  > .head-actions {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    flex: none;
  }

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

.archive-dir-row {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  min-width: 0;
}

.archive-dir-path {
  flex: 1;
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacing-xs);
}

.library-thumb {
  flex: none;
  width: 34px;
  height: 34px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  background: var(--color-fill);
}

.library-thumb--empty {
  display: grid;
  place-items: center;
  color: var(--color-text-tertiary);
}

.library-group {
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

@media (prefers-reduced-motion: reduce) {
  .loading-dot {
    animation: none;
  }
}
</style>
