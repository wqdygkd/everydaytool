// tweb-cache 渲染层状态：站点信息 + 影库 / 回收站。
// 归档状态由主进程推送：已有条目就地更新进度，新条目才防抖重扫列表。
import type {
  ArchiveLibraryEntry,
  ArchiveLibraryEvent,
  ArchiveTrashEntry,
} from '../../../../shared/media-archive'
import type {
  TwebCacheArchiveDirChangeResult,
  TwebCacheArchiveDirInfo,
  TwebCacheSiteInfo,
} from '../../../../shared/tweb-cache'
import { defineStore } from 'pinia'
import {
  invokeTwebCacheIpc as invoke,
  onTwebCacheIpc as on,
  twebCacheIpcChannels,
} from '../ipc'

export const useTwebCacheStore = defineStore('twebCache/state', () => {
  const site = ref<TwebCacheSiteInfo | null>(null)
  const archiveDir = ref<TwebCacheArchiveDirInfo | null>(null)
  const library = ref<ArchiveLibraryEntry[]>([])
  const trash = ref<ArchiveTrashEntry[]>([])
  const ready = ref(false)
  const busy = reactive({
    library: false,
    archiveDir: false,
  })
  /** 影库 → 页面的一次性跳转请求（页面侧消费） */
  const pendingJump = ref<{ peerId: string, messageId: number } | null>(null)
  let disposers: Array<() => void> = []
  let libraryRefreshTimer: number | undefined
  let trashRefreshTimer: number | undefined
  /** 正在下载的消息（事件驱动）；重扫影库时用来覆盖扫描结果里的 partial */
  const activeArchives = new Map<string, number>()
  /** 暂停后短暂忽略仍在上报的 downloading 事件（in-flight append 可能晚到） */
  let suppressActiveUntil = 0
  let initialized = false

  const pendingArchives = computed(() => library.value.filter(entry => entry.state !== 'complete'))
  const siteReady = computed(() => site.value?.ready === true)

  function channels(): Record<string, string> {
    return twebCacheIpcChannels()
  }

  function archiveKeyOf(peerId: string, messageId: number): string {
    return `${peerId}:${messageId}`
  }

  function markArchiveIdle(peerId: string, messageId: number): void {
    const key = archiveKeyOf(peerId, messageId)
    const timer = activeArchives.get(key)
    if (timer !== undefined) window.clearTimeout(timer)
    activeArchives.delete(key)
  }

  /** 下载事件到达即刷新；45s 没有新进度就当作中断，避免失败后一直显示「缓存中」 */
  function markArchiveActive(peerId: string, messageId: number): void {
    if (Date.now() < suppressActiveUntil) return
    markArchiveIdle(peerId, messageId)
    const key = archiveKeyOf(peerId, messageId)
    activeArchives.set(key, window.setTimeout(() => {
      activeArchives.delete(key)
      const index = library.value.findIndex(
        entry => entry.peerId === peerId && entry.messageId === messageId,
      )
      if (index >= 0 && library.value[index].state === 'downloading') {
        library.value[index] = { ...library.value[index], state: 'partial' }
      }
    }, 45_000))
  }

  function clearActiveArchives(): void {
    for (const timer of activeArchives.values()) window.clearTimeout(timer)
    activeArchives.clear()
    suppressActiveUntil = Date.now() + 2_000
  }

  /** 扫描结果里没有「正在下载」这个概念：用事件集合补回来 */
  function overlayActive(entries: ArchiveLibraryEntry[]): ArchiveLibraryEntry[] {
    if (!activeArchives.size) return entries
    return entries.map(entry => (
      entry.state !== 'complete' && activeArchives.has(archiveKeyOf(entry.peerId, entry.messageId))
        ? { ...entry, state: 'downloading' }
        : entry
    ))
  }

  function applyLibraryEvent(next: ArchiveLibraryEvent): void {
    const index = library.value.findIndex(
      entry => entry.peerId === next.peerId && entry.messageId === next.messageId,
    )

    // partial 基本都是收尾事件（最后一片 / commit 未齐），一律当作任务已结束
    if (next.state === 'downloading') markArchiveActive(next.peerId, next.messageId)
    else markArchiveIdle(next.peerId, next.messageId)

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

  /** 打开页签：拉起站点（懒启动）并返回站点状态 */
  async function acquireSite(): Promise<void> {
    site.value = await invoke<TwebCacheSiteInfo>(channels().SITE_ACQUIRE)
  }

  /** 关闭页签：释放站点引用（主进程归零后延迟停站点），只通知不等待 */
  function releaseSite(): void {
    void invoke(channels().SITE_RELEASE).catch(() => undefined)
  }

  async function loadLibrary(silent = false): Promise<void> {
    if (!silent) busy.library = true
    try {
      library.value = overlayActive(await invoke<ArchiveLibraryEntry[]>(channels().LIBRARY_LIST))
    } finally {
      if (!silent) busy.library = false
    }
  }

  async function loadTrash(): Promise<void> {
    trash.value = await invoke<ArchiveTrashEntry[]>(channels().TRASH_LIST)
  }

  async function loadArchiveDirInfo(): Promise<void> {
    archiveDir.value = await invoke<TwebCacheArchiveDirInfo>(channels().ARCHIVE_DIR_INFO)
  }

  async function selectArchiveDir(): Promise<string | null> {
    return invoke<string | null>(channels().ARCHIVE_DIR_SELECT)
  }

  /** 切换归档目录（null = 恢复默认）；成功后重扫影库与回收站 */
  async function changeArchiveDir(directory: string | null): Promise<TwebCacheArchiveDirChangeResult> {
    busy.archiveDir = true
    try {
      const result = await invoke<TwebCacheArchiveDirChangeResult>(channels().ARCHIVE_DIR_CHANGE, directory)
      await Promise.all([loadArchiveDirInfo(), loadLibrary(), loadTrash()])
      return result
    } finally {
      busy.archiveDir = false
    }
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
        applyLibraryEvent(payload as ArchiveLibraryEvent)
      }))

      await acquireSite()
      await Promise.all([loadArchiveDirInfo(), loadLibrary(), loadTrash()])
      ready.value = true
    } catch (error) {
      dispose()
      throw error
    }
  }

  function dispose(): void {
    releaseSite()
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
    clearActiveArchives()
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
    archiveDir,
    library,
    trash,
    ready,
    busy,
    pendingJump,
    pendingArchives,
    siteReady,
    refreshSite,
    loadLibrary,
    clearActiveArchives,
    loadTrash,
    loadArchiveDirInfo,
    selectArchiveDir,
    changeArchiveDir,
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
