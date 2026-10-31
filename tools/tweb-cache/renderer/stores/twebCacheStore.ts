// tweb-cache 渲染层状态：站点信息 + 影库 / 回收站（数据经平台归档引擎按本工具 scope 提供）。
// 归档状态由主进程按 scope 推送：已有条目就地更新进度，新条目才防抖重扫列表。
import type {
  TelegramLibraryEntry,
  TelegramLibraryEvent,
  TelegramTrashEntry,
} from '../../../../shared/telegram-cache'
import type { TwebCacheSiteInfo } from '../../../../shared/tweb-cache'
import { defineStore } from 'pinia'
import {
  invokeTwebCacheIpc as invoke,
  onTwebCacheIpc as on,
  twebCacheIpcChannels,
} from '../ipc'

export const useTwebCacheStore = defineStore('twebCache/state', () => {
  const site = ref<TwebCacheSiteInfo | null>(null)
  const library = ref<TelegramLibraryEntry[]>([])
  const trash = ref<TelegramTrashEntry[]>([])
  const ready = ref(false)
  const busy = reactive({
    library: false,
  })
  /** 影库 → 页面的一次性跳转请求（页面侧消费） */
  const pendingJump = ref<{ peerId: string, messageId: number } | null>(null)
  let disposers: Array<() => void> = []
  let libraryRefreshTimer: number | undefined
  let trashRefreshTimer: number | undefined
  let initialized = false

  const pendingArchives = computed(() => library.value.filter(entry => entry.state !== 'complete'))
  const siteReady = computed(() => site.value?.ready === true)

  function channels(): Record<string, string> {
    return twebCacheIpcChannels()
  }

  function applyLibraryEvent(next: TelegramLibraryEvent): void {
    const index = library.value.findIndex(
      entry => entry.peerId === next.peerId && entry.messageId === next.messageId,
    )

    if (next.state === 'missing') {
      if (index >= 0) library.value.splice(index, 1)
      scheduleTrashRefresh()
      return
    }

    if (index < 0) {
      scheduleLibraryRefresh()
      return
    }

    const entry = library.value[index]
    library.value[index] = {
      ...entry,
      state: next.state,
      size: next.received ?? entry.size,
      progress: next.state === 'complete' ? 1 : (next.progress ?? entry.progress),
      savedAt: next.state === 'complete' ? (entry.savedAt ?? Date.now()) : entry.savedAt,
    }
  }

  function scheduleLibraryRefresh(): void {
    if (libraryRefreshTimer !== undefined) return
    libraryRefreshTimer = window.setTimeout(() => {
      libraryRefreshTimer = undefined
      void loadLibrary(true)
    }, 400)
  }

  function scheduleTrashRefresh(): void {
    if (trashRefreshTimer !== undefined) return
    trashRefreshTimer = window.setTimeout(() => {
      trashRefreshTimer = undefined
      void loadTrash()
    }, 400)
  }

  async function refreshSite(): Promise<void> {
    site.value = await invoke<TwebCacheSiteInfo>(channels().SITE_INFO)
  }

  async function loadLibrary(silent = false): Promise<void> {
    if (!silent) busy.library = true
    try {
      library.value = await invoke<TelegramLibraryEntry[]>(channels().LIBRARY_LIST)
    } finally {
      if (!silent) busy.library = false
    }
  }

  async function loadTrash(): Promise<void> {
    trash.value = await invoke<TelegramTrashEntry[]>(channels().TRASH_LIST)
  }

  /** 旧目录正名 + 旧账号层迁移（幂等）；有改动则重扫列表 */
  async function normalizeLibrary(): Promise<{ messages: number, changed: number, migrated: number }> {
    const summary = await invoke<{ messages: number, changed: number, migrated: number }>(channels().LIBRARY_NORMALIZE)
    if (summary.changed > 0 || summary.migrated > 0) await loadLibrary()
    return summary
  }

  async function deleteMessage(peerId: string, messageId: number): Promise<void> {
    await invoke(channels().LIBRARY_DELETE, { peerId, messageId })
    await Promise.all([loadLibrary(), loadTrash()])
  }

  async function openMessageDir(peerId: string, messageId: number): Promise<void> {
    await invoke(channels().LIBRARY_OPEN_DIR, { peerId, messageId })
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

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true

    try {
      disposers.push(on(channels().EVENT_LIBRARY, (payload) => {
        applyLibraryEvent(payload as TelegramLibraryEvent)
      }))

      await refreshSite()
      await Promise.all([loadLibrary(), loadTrash()])
      ready.value = true
    } catch (error) {
      dispose()
      throw error
    }
  }

  function dispose(): void {
    for (const off of disposers) off()
    disposers = []
    if (libraryRefreshTimer !== undefined) {
      window.clearTimeout(libraryRefreshTimer)
      libraryRefreshTimer = undefined
    }
    if (trashRefreshTimer !== undefined) {
      window.clearTimeout(trashRefreshTimer)
      trashRefreshTimer = undefined
    }
    initialized = false
    ready.value = false
  }

  function requestJump(peerId: string, messageId: number): void {
    pendingJump.value = { peerId, messageId }
  }

  function consumeJump(): { peerId: string, messageId: number } | null {
    const jump = pendingJump.value
    pendingJump.value = null
    return jump
  }

  return {
    site,
    library,
    trash,
    ready,
    busy,
    pendingJump,
    pendingArchives,
    siteReady,
    refreshSite,
    loadLibrary,
    loadTrash,
    normalizeLibrary,
    deleteMessage,
    openMessageDir,
    restoreTrash,
    emptyTrash,
    openDataDir,
    init,
    dispose,
    requestJump,
    consumeJump,
  }
})
