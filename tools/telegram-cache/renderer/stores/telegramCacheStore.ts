// telegram-cache 渲染层状态：主进程快照 + 增量事件（快照 700ms 节流；任务与归档进度逐次推送）。
// 所有失败都向上抛，由面板决定如何提示（与 interceptor / offline-pack 一致）。
import type {
  TelegramCacheConfig,
  TelegramDiagnosticsExport,
  TelegramLibraryEntry,
  TelegramLibraryEvent,
  TelegramMtprotoStatus,
  TelegramSnapshot,
  TelegramTrashEntry,
} from '../../../../shared/telegram-cache'
import { defineStore } from 'pinia'
import { invokeTelegramCacheIpc as invoke, onTelegramCacheIpc as on, telegramCacheIpcChannels } from '../ipc'

export interface LibraryMediaItem {
  mediaKey: string
  mimeType?: string
  fileName?: string
  size: number
  relativePath: string
  url: string
}

export const useTelegramCacheStore = defineStore('telegramCache/state', () => {
  const snapshot = ref<TelegramSnapshot | null>(null)
  const library = ref<TelegramLibraryEntry[]>([])
  const trash = ref<TelegramTrashEntry[]>([])
  const libraryMedia = ref<LibraryMediaItem[]>([])
  const mtproto = ref<TelegramMtprotoStatus | null>(null)
  const diagnostics = ref<TelegramDiagnosticsExport | null>(null)
  const pageWebContentsId = ref<number | null>(null)
  /** 影库 → 内嵌页面的一次性跳转请求（由 TelegramCachePage 消费） */
  const pendingJump = ref<{ peerId: string, messageId: number } | null>(null)
  const ready = ref(false)
  let libraryRefreshTimer: number | undefined
  const busy = reactive({
    diagnostics: false,
    cache: false,
    library: false,
  })

  const config = computed<TelegramCacheConfig | null>(() => snapshot.value?.config ?? null)
  const cache = computed(() => snapshot.value?.cache ?? null)
  const site = computed(() => snapshot.value?.site ?? null)

  let disposers: Array<() => void> = []
  let initialized = false

  function channels(): Record<string, string> {
    return telegramCacheIpcChannels()
  }

  function applySnapshot(next: TelegramSnapshot): void {
    snapshot.value = next
  }

  /** 归档进度推送：已在列表里的条目就地更新；新条目（首次缓存）延迟拉一次列表 */
  function applyLibraryEvent(next: TelegramLibraryEvent): void {
    const index = library.value.findIndex(
      entry => entry.peerId === next.peerId && entry.messageId === next.messageId,
    )
    if (index < 0) {
      scheduleLibraryRefresh()
      return
    }
    const entry = library.value[index]
    library.value[index] = {
      ...entry,
      state: next.state,
      progress: next.state === 'complete' ? 1 : (next.progress ?? entry.progress),
      size: next.received ?? entry.size,
      savedAt: next.state === 'complete' ? (entry.savedAt ?? Date.now()) : entry.savedAt,
    }
  }

  /** 新目录刚出现时合并多次推送，只重扫一次（扫描是读盘操作） */
  function scheduleLibraryRefresh(): void {
    if (libraryRefreshTimer !== undefined) return
    libraryRefreshTimer = window.setTimeout(() => {
      libraryRefreshTimer = undefined
      void loadLibrary()
    }, 400)
  }

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    const ch = channels()

    disposers.push(on(ch.EVENT_SNAPSHOT, (payload) => {
      applySnapshot(payload as TelegramSnapshot)
    }))
    disposers.push(on(ch.EVENT_MTPROTO, (payload) => {
      mtproto.value = payload as TelegramMtprotoStatus
    }))
    disposers.push(on(ch.EVENT_LIBRARY, (payload) => {
      applyLibraryEvent(payload as TelegramLibraryEvent)
    }))

    const [initialSnapshot, initialMtproto] = await Promise.all([
      invoke<TelegramSnapshot>(ch.SNAPSHOT_GET),
      invoke<TelegramMtprotoStatus>(ch.MT_STATUS),
    ])
    applySnapshot(initialSnapshot)
    mtproto.value = initialMtproto
    ready.value = true
  }

  function dispose(): void {
    for (const off of disposers) off()
    disposers = []
    if (libraryRefreshTimer !== undefined) {
      window.clearTimeout(libraryRefreshTimer)
      libraryRefreshTimer = undefined
    }
    initialized = false
    ready.value = false
  }

  async function updateConfig(patch: Partial<TelegramCacheConfig>): Promise<void> {
    const result = await invoke<{ config: TelegramCacheConfig, snapshot: TelegramSnapshot }>(channels().CONFIG_SET, patch)
    applySnapshot(result.snapshot)
  }

  async function clearCache(): Promise<{ evictedBytes: number, evictions: number }> {
    busy.cache = true
    try {
      const result = await invoke<{ evictedBytes: number, evictions: number, snapshot: TelegramSnapshot }>(
        channels().CACHE_CLEAR,
      )
      applySnapshot(result.snapshot)
      return { evictedBytes: result.evictedBytes, evictions: result.evictions }
    } finally {
      busy.cache = false
    }
  }

  async function attachPage(webContentsId: number): Promise<void> {
    pageWebContentsId.value = webContentsId
    await invoke(channels().PAGE_ATTACH, webContentsId)
  }

  async function loadLibrary(): Promise<void> {
    busy.library = true
    try {
      library.value = await invoke<TelegramLibraryEntry[]>(channels().MSG_LIBRARY_LIST)
    } finally {
      busy.library = false
    }
  }

  /** 旧目录正名（幂等）：`001.jpg` / `text.md` → `media/<mediaKey>.<ext>` / `message.md`，并迁走旧的 acc 层 */
  async function normalizeLibrary(): Promise<{ messages: number, changed: number, migrated: number }> {
    const summary = await invoke<{ messages: number, changed: number, migrated: number }>(
      channels().MSG_LIBRARY_NORMALIZE,
    )
    if (summary.changed > 0 || summary.migrated > 0) await loadLibrary()
    return summary
  }

  async function loadTrash(): Promise<void> {
    trash.value = await invoke<TelegramTrashEntry[]>(channels().TRASH_LIST)
  }

  async function loadLibraryMedia(peerId: string, messageId: number): Promise<LibraryMediaItem[]> {
    const result = await invoke<{ origin: string, items: LibraryMediaItem[] }>(channels().MSG_LIBRARY_MEDIA, {
      peerId,
      messageId,
    })
    libraryMedia.value = result.items
    return result.items
  }

  async function deleteLibraryMessage(peerId: string, messageId: number): Promise<void> {
    await invoke(channels().MSG_LIBRARY_DELETE, { peerId, messageId })
    await Promise.all([loadLibrary(), loadTrash()])
  }

  async function openLibraryDir(peerId: string, messageId: number): Promise<void> {
    await invoke(channels().MSG_LIBRARY_OPEN_DIR, { peerId, messageId })
  }

  /** 请求内嵌页面跳到某条消息（页面侧消费 pendingJump 后调 consumeJump 清空） */
  function requestJump(peerId: string, messageId: number): void {
    pendingJump.value = { peerId, messageId }
  }

  function consumeJump(): { peerId: string, messageId: number } | null {
    const jump = pendingJump.value
    pendingJump.value = null
    return jump
  }

  async function restoreTrash(trashId: string): Promise<void> {
    await invoke(channels().TRASH_RESTORE, trashId)
    await Promise.all([loadLibrary(), loadTrash()])
  }

  async function emptyTrash(olderThanDays?: number): Promise<number> {
    const removed = await invoke<number>(channels().TRASH_EMPTY, olderThanDays)
    await loadTrash()
    return removed
  }

  async function openDataDir(): Promise<void> {
    await invoke(channels().OPEN_DATA_DIR)
  }

  async function refreshMtprotoStatus(): Promise<void> {
    mtproto.value = await invoke<TelegramMtprotoStatus>(channels().MT_STATUS)
  }

  async function startMtprotoDownload(link: string): Promise<{ taskId: string }> {
    return invoke<{ taskId: string }>(channels().MT_DOWNLOAD, link)
  }

  async function cancelMtprotoDownload(): Promise<boolean> {
    return invoke<boolean>(channels().MT_CANCEL)
  }

  async function migrateMtprotoSession(): Promise<void> {
    mtproto.value = await invoke<TelegramMtprotoStatus>(channels().MT_SESSION_MIGRATE)
  }

  async function clearMtprotoSecureSession(): Promise<void> {
    mtproto.value = await invoke<TelegramMtprotoStatus>(channels().MT_SESSION_CLEAR)
  }

  async function exportDiagnostics(): Promise<TelegramDiagnosticsExport> {
    busy.diagnostics = true
    try {
      const result = await invoke<TelegramDiagnosticsExport>(channels().DIAGNOSTICS_EXPORT)
      diagnostics.value = result
      return result
    } finally {
      busy.diagnostics = false
    }
  }

  return {
    snapshot,
    library,
    trash,
    libraryMedia,
    mtproto,
    diagnostics,
    pageWebContentsId,
    pendingJump,
    ready,
    busy,
    config,
    cache,
    site,
    init,
    dispose,
    updateConfig,
    clearCache,
    attachPage,
    loadLibrary,
    normalizeLibrary,
    loadTrash,
    loadLibraryMedia,
    deleteLibraryMessage,
    openLibraryDir,
    requestJump,
    consumeJump,
    restoreTrash,
    emptyTrash,
    openDataDir,
    refreshMtprotoStatus,
    startMtprotoDownload,
    cancelMtprotoDownload,
    migrateMtprotoSession,
    clearMtprotoSecureSession,
    exportDiagnostics,
  }
})
