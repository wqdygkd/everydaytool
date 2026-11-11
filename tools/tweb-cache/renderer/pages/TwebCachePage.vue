<script setup lang="ts">
import type { ArchiveLibraryEntry, ArchiveTrashEntry } from '../../../../shared/media-archive'
import type { TwebWebviewTag } from '../webview'
import { isElectronEnvironment } from '@renderer/shared/environment'
import { confirm } from '@renderer/shared/feedback'
import { openExternal } from '@renderer/shared/ipc/openExternal'
import { toast } from 'vue-sonner'
import ToolSurface from '../../../../renderer/shared/components/workspace/ToolSurface.vue'
import { TWEB_CACHE_WEBVIEW_PARTITION } from '../../../../shared/webview'
import { useTwebCacheStore } from '../stores/twebCacheStore'
import { formatBytes } from '../utils/format'

const store = useTwebCacheStore()
const isElectron = isElectronEnvironment()

const LIB_WIDTH_KEY = 'twebCache.libraryWidth'
const LIB_DEFAULT_WIDTH = 504
const LIB_MIN_WIDTH = 360
const LIB_MAX_WIDTH = 760
const LIB_RESIZE_STEP = 24
const LIB_MIN_GUEST_WIDTH = 320

function readLibraryWidth(): number {
  try {
    const raw = localStorage.getItem(LIB_WIDTH_KEY)
    if (!raw) return LIB_DEFAULT_WIDTH
    const width = Number(raw)
    if (!Number.isFinite(width)) return LIB_DEFAULT_WIDTH
    return Math.min(LIB_MAX_WIDTH, Math.max(LIB_MIN_WIDTH, Math.round(width)))
  } catch {
    return LIB_DEFAULT_WIDTH
  }
}

const webviewRef = shallowRef<TwebWebviewTag | null>(null)
const boundElements = new WeakSet<object>()
const pageUrl = ref('')
const loading = ref(true)
const loadError = ref('')
const initError = ref('')
const canGoBack = ref(false)
const canGoForward = ref(false)
const devtoolsOpen = ref(false)
const libraryFilter = ref('')
const pausingAll = ref(false)
const mediaCacheClearing = ref(false)
const thumbnailBackfillRunning = ref(false)
const libraryWidth = ref(readLibraryWidth())
const splitRef = ref<HTMLElement | null>(null)
const resizingLibrary = ref(false)

let dragState: {
  pointerId: number
  startX: number
  startWidth: number
  handle: HTMLElement
} | null = null
let previousUserSelect = ''
let previousCursor = ''

const site = computed(() => store.site)
const pageSrc = computed(() => site.value?.url ?? '')
const siteError = computed(() => site.value?.error ?? '')
const originNotice = computed(() => (site.value?.originChanged ? site.value.portNote ?? '' : ''))
const originNoticeDismissed = ref(false)
watch(originNotice, () => {
  originNoticeDismissed.value = false
})

const displayUrl = computed(() => pageUrl.value || pageSrc.value || '')
const hasActiveCache = computed(() => store.library.some(entry => entry.state === 'downloading'))
const libraryTotalSize = computed(() =>
  store.library.reduce((sum, entry) => sum + (Number.isFinite(entry.size) ? entry.size : 0), 0),
)

interface LibraryRow extends ArchiveLibraryEntry {
  groupTitle: string
  groupSize: number
  /** 组内首行 = 组大小；其余行 = 0（被上面的单元格合并掉） */
  groupSpan: number
}

const filteredLibrary = computed(() => {
  const query = libraryFilter.value.trim().toLowerCase()
  if (!query) return store.library
  return store.library.filter((entry) => {
    const haystack = `${entry.peerTitle ?? ''} ${entry.peerId} ${entry.messageId}`.toLowerCase()
    return haystack.includes(query)
  })
})

const groupedLibrary = computed<LibraryRow[]>(() => {
  const groups = new Map<string, ArchiveLibraryEntry[]>()
  for (const entry of filteredLibrary.value) {
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

const libraryMenuItems = computed(() => [
  { command: 'open-dir', label: '打开归档目录', icon: 'layers' as const },
  { command: 'change-dir', label: '更改归档目录…', icon: 'refresh' as const },
  ...(store.archiveDir?.isCustom
    ? [{ command: 'reset-dir', label: '恢复默认目录', icon: 'refresh' as const }]
    : []),
  { command: 'clear-media', label: '清理 tweb 媒体缓存', icon: 'trash' as const, danger: true },
])

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
    void backfillThumbnails()
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

// —— 影库宽度：默认 504，可拖 360–760；分隔条键盘 ←/→ 每次 24px ——
function maxAllowedLibraryWidth(): number {
  const total = splitRef.value?.clientWidth ?? 0
  if (!total) return LIB_MAX_WIDTH
  return Math.max(LIB_MIN_WIDTH, Math.min(LIB_MAX_WIDTH, total - LIB_MIN_GUEST_WIDTH))
}

function applyLibraryWidth(value: number): number {
  const next = Math.round(Math.min(maxAllowedLibraryWidth(), Math.max(LIB_MIN_WIDTH, value)))
  libraryWidth.value = next
  return next
}

function writeLibraryWidth(): void {
  try {
    localStorage.setItem(LIB_WIDTH_KEY, String(libraryWidth.value))
  } catch {}
}

function startLibraryResize(event: PointerEvent): void {
  if (event.button !== 0) return
  const handle = event.currentTarget as HTMLElement | null
  if (!handle) return
  dragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: libraryWidth.value,
    handle,
  }
  resizingLibrary.value = true
  try {
    handle.setPointerCapture(event.pointerId)
  } catch {}
  handle.focus({ preventScroll: true })
  previousUserSelect = document.body.style.userSelect
  previousCursor = document.body.style.cursor
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  event.preventDefault()
}

function moveLibraryResize(event: PointerEvent): void {
  if (!dragState || event.pointerId !== dragState.pointerId) return
  applyLibraryWidth(dragState.startWidth + (dragState.startX - event.clientX))
}

function finishLibraryResize(event?: PointerEvent): void {
  if (!dragState) return
  if (event && event.pointerId !== dragState.pointerId) return
  const { handle, pointerId } = dragState
  dragState = null
  resizingLibrary.value = false
  try {
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
  } catch {}
  document.body.style.userSelect = previousUserSelect
  document.body.style.cursor = previousCursor
  writeLibraryWidth()
}

function resizeLibraryByKeyboard(event: KeyboardEvent): void {
  let next: number | null = null
  if (event.key === 'ArrowLeft') next = libraryWidth.value - LIB_RESIZE_STEP
  else if (event.key === 'ArrowRight') next = libraryWidth.value + LIB_RESIZE_STEP
  else if (event.key === 'Home') next = LIB_MIN_WIDTH
  else if (event.key === 'End') next = maxAllowedLibraryWidth()
  if (next === null) return
  event.preventDefault()
  applyLibraryWidth(next)
  writeLibraryWidth()
}

// —— tweb 媒体缓存（页面侧 Cache Storage）：只保留手动清理入口 ——
type MediaCacheBucket = 'cachedFiles' | 'cachedStreamChunks' | 'cachedHlsQualityFiles' | 'cachedHlsStreamChunks'
const MEDIA_CACHE_BUCKETS: readonly MediaCacheBucket[] = ['cachedFiles', 'cachedStreamChunks', 'cachedHlsQualityFiles', 'cachedHlsStreamChunks']

async function runMediaCacheBridge<T>(script: string): Promise<T | null> {
  const wv = webviewRef.value
  if (!wv) return null
  try {
    return (await wv.executeJavaScript(script, true)) as T | null
  } catch {
    return null
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
    if (typeof cleared === 'number') toast.success(`已清理 ${cleared} 个媒体缓存桶`)
    else toast.warning('tweb 页面尚未就绪，无法清理')
  } finally {
    mediaCacheClearing.value = false
  }
}

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

async function onLibraryCommand(command: string): Promise<void> {
  if (command === 'open-dir') {
    await openDataDir()
    return
  }
  if (command === 'change-dir') {
    await selectArchiveDir()
    return
  }
  if (command === 'reset-dir') {
    await resetArchiveDir()
    return
  }
  if (command === 'clear-media') await clearMediaCache()
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
  void store.normalizeLibrary().catch(() => undefined)
  void backfillThumbnails()
})

onUnmounted(() => {
  const wv = webviewRef.value
  if (wv && devtoolsOpen.value) safeCall(() => wv.closeDevTools(), undefined)
  webviewRef.value = null
  writeLibraryWidth()
  store.dispose()
})
</script>

<template>
  <div class="tool-page tweb-page">
    <ToolSurface class="tweb-surface">
      <div ref="splitRef" class="tg-split" :class="{ 'is-resizing': resizingLibrary }">
        <div class="tg-guest">
          <div class="guest-bar">
            <UiIconButton icon="arrowLeft" :size="24" label="后退" :disabled="!canGoBack" @click="goBack" />
            <UiIconButton icon="arrowRight" :size="24" label="前进" :disabled="!canGoForward" @click="goForward" />
            <UiIconButton icon="refresh" :size="24" label="刷新页面" @click="reload" />
            <span class="guest-url mono" :title="displayUrl">{{ displayUrl }}</span>
            <span v-if="loading" class="loading-dot" aria-label="加载中" />
            <UiIconButton
              icon="external"
              :size="24"
              label="外部打开"
              :disabled="!displayUrl"
              @click="openInBrowser"
            />
            <UiIconButton
              icon="script"
              :size="24"
              label="页面开发者工具"
              :active="devtoolsOpen"
              @click="toggleDevTools"
            />
          </div>

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
        </div>

        <div
          class="tg-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整影库宽度"
          :aria-valuemin="LIB_MIN_WIDTH"
          :aria-valuemax="LIB_MAX_WIDTH"
          :aria-valuenow="libraryWidth"
          tabindex="0"
          @pointerdown="startLibraryResize"
          @pointermove="moveLibraryResize"
          @pointerup="finishLibraryResize"
          @pointercancel="finishLibraryResize"
          @lostpointercapture="finishLibraryResize"
          @keydown="resizeLibraryByKeyboard"
        />

        <aside class="tg-lib" :style="{ '--lib-width': `${libraryWidth}px` }">
          <header class="tg-lib-head">
            <UiIcon name="layers" :size="14" />
            <span>影库</span>
            <span class="meta">{{ store.library.length }} 条 · {{ formatBytes(libraryTotalSize) }}</span>
            <UiDropdown :items="libraryMenuItems" @command="onLibraryCommand">
              <template #trigger>
                <UiIconButton icon="more" :size="24" label="影库操作" />
              </template>
            </UiDropdown>
          </header>

          <div class="tg-tools">
            <label class="lib-search">
              <UiIcon name="search" :size="14" />
              <input
                v-model="libraryFilter"
                type="search"
                placeholder="搜索消息或媒体"
                aria-label="搜索影库"
              >
            </label>
            <UiIconButton
              icon="pause"
              :size="28"
              label="全部暂停"
              :disabled="!hasActiveCache"
              :loading="pausingAll"
              @click="pauseAllCaches"
            />
            <UiIconButton
              icon="refresh"
              :size="28"
              label="刷新影库"
              :loading="store.busy.library"
              @click="refreshAll"
            />
          </div>

          <div class="lib-table">
            <UiTable
              :data="groupedLibrary"
              :span-method="librarySpanMethod"
              height="100%"
              empty-text="还没有本地缓存：先在 tweb 页面里右键「缓存此消息」"
            >
              <UiTableColumn label="会话 / 消息" min-width="110">
                <template #default="{ row }">
                  <span class="library-group">
                    <span class="mono library-title" :title="row.groupTitle">{{ row.groupTitle }}</span>
                    <span v-if="row.groupSize > 1" class="muted">相册 · {{ row.groupSize }} 条</span>
                  </span>
                </template>
              </UiTableColumn>
              <UiTableColumn label="消息 ID" width="56" align="right">
                <template #default="{ row }">
                  <span class="mono">{{ row.messageId }}</span>
                </template>
              </UiTableColumn>
              <UiTableColumn label="预览" width="52">
                <template #default="{ row }">
                  <img
                    v-if="row.thumbnailUrl"
                    class="library-thumb"
                    :src="row.thumbnailUrl"
                    loading="lazy"
                    alt=""
                  >
                  <span v-else class="library-thumb library-thumb--empty">
                    <UiIcon name="layers" :size="13" />
                  </span>
                </template>
              </UiTableColumn>
              <UiTableColumn label="大小" width="64" align="right">
                <template #default="{ row }">
                  <span class="mono">{{ formatBytes(row.size) }}</span>
                </template>
              </UiTableColumn>
              <UiTableColumn label="状态" width="76">
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
              <UiTableColumn label="操作" width="108" align="right">
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
          </div>

          <section class="trash-sec">
            <header class="tg-sub-head">
              <UiIcon name="trash" :size="12" />
              <span>回收站</span>
              <span>{{ store.trash.length }} 条记录</span>
            </header>
            <UiTable :data="store.trash" max-height="150" empty-text="回收站为空">
              <UiTableColumn label="会话 / 消息" min-width="180" show-overflow-tooltip>
                <template #default="{ row }">
                  <span class="mono">{{ row.peerId }} / {{ row.messageId }}</span>
                </template>
              </UiTableColumn>
              <UiTableColumn label="操作" width="64" align="right">
                <template #default="{ row }">
                  <UiButton size="small" text type="primary" @click="restoreTrash(toTrash(row))">
                    恢复
                  </UiButton>
                </template>
              </UiTableColumn>
            </UiTable>
          </section>
        </aside>
      </div>
    </ToolSurface>
  </div>
</template>

<style scoped lang="scss">
.tweb-page {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}

.tweb-surface {
  min-width: 0;
  min-height: 0;
}

.tg-split {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;

  &.is-resizing {
    cursor: col-resize;
  }
}

.tg-guest {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--color-app-bg);
}

.guest-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 36px;
  height: 36px;
  min-width: 0;
  padding: 0 10px;
  border-bottom: 1px solid var(--color-border-light);
  background: var(--color-raised);
}

.guest-url {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-control);
  background: var(--color-input);
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 24px;
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

.tg-grip {
  position: relative;
  flex: 0 0 7px;
  width: 7px;
  cursor: col-resize;
  background: transparent;
  outline: none;
  touch-action: none;

  &::after {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
    background: var(--color-border-light);
    content: '';
    transition: background-color var(--transition-fast);
  }

  &:hover::after,
  &:focus-visible::after,
  .tg-split.is-resizing &::after {
    left: 2.5px;
    width: 2px;
    background: var(--color-primary);
  }
}

.tg-lib {
  display: flex;
  flex: 0 0 var(--lib-width);
  flex-direction: column;
  width: var(--lib-width);
  min-height: 0;
  overflow: hidden;
  background: var(--color-fill);
}

.tg-lib-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 40px;
  height: 40px;
  min-width: 0;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--color-border-light);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);

  > span:first-of-type {
    color: var(--color-text-primary);
  }

  .meta {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-size: 11px;
    font-weight: var(--font-weight-regular);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
}

.tg-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border-light);
}

.lib-search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-control);
  background: var(--color-input);
  color: var(--color-text-tertiary);

  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-text-primary);
    font-family: inherit;
    font-size: var(--font-size-xs);
    outline: none;

    &::placeholder {
      color: var(--color-text-tertiary);
    }

    &::-webkit-search-cancel-button {
      display: none;
    }
  }

  &:focus-within {
    border-color: color-mix(in srgb, var(--color-primary) 38%, var(--color-border));
  }
}

.lib-table {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;

  :deep(.ui-table-wrap) {
    flex: 1;
    min-height: 0;
    border-radius: 0;
  }
}

.trash-sec {
  flex: none;
  min-width: 0;
  border-top: 1px solid var(--color-border-light);
  background: var(--color-fill);

  :deep(.ui-table-wrap) {
    border-radius: 0;
  }
}

.tg-sub-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px 4px;
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: var(--font-weight-medium);

  > span:last-child {
    margin-left: auto;
    font-weight: var(--font-weight-regular);
    font-variant-numeric: tabular-nums;
  }
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

.library-thumb {
  flex: none;
  width: 30px;
  height: 30px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  background: var(--color-fill);
}

.library-thumb--empty {
  display: grid;
  place-items: center;
  color: var(--color-text-tertiary);
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

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacing-xs);
}

@media (prefers-reduced-motion: reduce) {
  .loading-dot {
    animation: none;
  }
}
</style>
