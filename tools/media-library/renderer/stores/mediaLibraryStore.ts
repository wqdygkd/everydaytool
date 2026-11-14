import type {
  ArtistUpdateRequest,
  BusyState,
  CollectionPatch,
  CollectionSummary,
  ImportCommitRequest,
  MediaEndpoint,
  MediaLibraryOverview,
  MediaLibraryPrefs,
  ScanLogEntry,
  ScanOptions,
  ScanProgress,
  ScanResult,
} from '@shared/media-library'
import {
  collectionNeeds,
  createImportSelection,
  DEFAULT_PREFS,
  DEFAULT_SCAN_OPTIONS,
} from '@shared/media-library'
import { defineStore } from 'pinia'
import * as ipc from '../ipc'

export type ImportStage = 'select' | 'scan' | 'confirm' | 'result'

function emptyOverview(): MediaLibraryOverview {
  return {
    collections: [],
    tags: [],
    artists: [],
    series: [],
    sources: [],
    prefs: { ...DEFAULT_PREFS },
  }
}

export const useMediaLibraryStore = defineStore('mediaLibrary/state', () => {
  const overview = ref<MediaLibraryOverview>(emptyOverview())
  const endpoint = ref<MediaEndpoint | null>(null)
  const busy = ref<BusyState>({ busy: false, label: '' })
  const scanProgress = ref<ScanProgress | null>(null)
  const scanLog = ref<ScanLogEntry[]>([])
  const ready = ref(false)
  const importSession = reactive({
    scanResult: null as ScanResult | null,
    selection: createImportSelection(),
    options: { ...DEFAULT_SCAN_OPTIONS } as ScanOptions,
    stage: 'select' as ImportStage,
  })

  let initialized = false
  let acquired = false
  let disposers: Array<() => void> = []

  function applyOverview(next: MediaLibraryOverview): MediaLibraryOverview {
    overview.value = next
    return next
  }

  async function refresh(): Promise<MediaLibraryOverview> {
    return applyOverview(await ipc.getOverview())
  }

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    disposers.push(
      ipc.onBusy((state) => { busy.value = state }),
      ipc.onScanProgress((progress) => { scanProgress.value = progress }),
    )
    try {
      endpoint.value = await ipc.acquireMedia()
      acquired = true
      const [nextOverview, nextLog] = await Promise.all([ipc.getOverview(), ipc.getScanLog()])
      applyOverview(nextOverview)
      scanLog.value = nextLog
      ready.value = true
    } catch (error) {
      for (const off of disposers) off()
      disposers = []
      initialized = false
      if (acquired) {
        acquired = false
        await ipc.releaseMedia().catch(() => undefined)
      }
      endpoint.value = null
      throw error
    }
  }

  async function dispose(): Promise<void> {
    for (const off of disposers) off()
    disposers = []
    initialized = false
    ready.value = false
    busy.value = { busy: false, label: '' }
    scanProgress.value = null
    if (acquired) {
      acquired = false
      await ipc.releaseMedia().catch(() => undefined)
    }
    endpoint.value = null
  }

  function resetImport(): void {
    importSession.scanResult = null
    importSession.selection = createImportSelection()
    importSession.options = { ...DEFAULT_SCAN_OPTIONS }
    importSession.stage = 'select'
  }

  async function scan(scanId: string, path: string): Promise<ScanResult | null> {
    importSession.stage = 'scan'
    // options 是 Pinia 的 reactive 代理，IPC 走结构化克隆，必须传纯对象
    const result = await ipc.startScan(scanId, path, { ...importSession.options })
    importSession.scanResult = result
    importSession.stage = result ? 'confirm' : 'select'
    return result
  }

  async function commitImport(request: ImportCommitRequest) {
    const result = await ipc.commitImport(request)
    applyOverview(result.overview)
    importSession.stage = 'result'
    return result
  }

  async function updateCollection(id: string, patch: CollectionPatch) {
    return applyOverview(await ipc.updateCollection(id, patch))
  }

  async function removeCollection(id: string) {
    return applyOverview(await ipc.removeCollection(id))
  }

  async function saveProgress(collectionId: string, itemId: string, position: number, duration: number): Promise<void> {
    await ipc.saveProgress(collectionId, itemId, position, duration)
    const index = overview.value.collections.findIndex(collection => collection.id === collectionId)
    if (index < 0) return
    const collections = [...overview.value.collections]
    collections[index] = {
      ...collections[index],
      progress: { itemId, position, duration, updatedAt: new Date().toISOString() },
    }
    overview.value = { ...overview.value, collections }
  }

  async function fillItemMeta(collectionId: string, itemId: string, meta: { width?: number, height?: number, duration?: number }) {
    const summary = await ipc.fillItemMeta(collectionId, itemId, meta)
    if (!summary) return null
    const collections = overview.value.collections.map(collection => collection.id === summary.id ? summary : collection)
    overview.value = { ...overview.value, collections }
    return summary
  }

  async function rescanCollection(id: string) {
    const result = await ipc.rescanCollection(id)
    applyOverview(result.overview)
    return result
  }

  async function createTag(name: string) {
    return applyOverview(await ipc.createTag(name))
  }

  async function deleteTag(name: string) {
    return applyOverview(await ipc.deleteTag(name))
  }

  async function updateArtist(request: ArtistUpdateRequest) {
    const result = await ipc.updateArtist(request)
    applyOverview(result.overview)
    return result
  }

  async function createSeries(name: string, description: string) {
    const result = await ipc.createSeries(name, description)
    applyOverview(result.overview)
    return result
  }

  async function updateSeries(id: string, name: string, description: string) {
    return applyOverview(await ipc.updateSeries(id, name, description))
  }

  async function deleteSeries(id: string) {
    return applyOverview(await ipc.deleteSeries(id))
  }

  async function addToSeries(id: string, collectionIds: string[]) {
    return applyOverview(await ipc.addToSeries(id, collectionIds))
  }

  async function removeFromSeries(id: string, collectionId: string) {
    return applyOverview(await ipc.removeFromSeries(id, collectionId))
  }

  async function rescanSource(id: string) {
    const result = await ipc.rescanSource(id)
    applyOverview(result.overview)
    return result
  }

  async function removeSource(id: string) {
    return applyOverview(await ipc.removeSource(id))
  }

  async function checkSources() {
    return applyOverview(await ipc.checkSources())
  }

  async function rescanAll() {
    const result = await ipc.rescanAll()
    applyOverview(result.overview)
    scanLog.value = await ipc.getScanLog()
    return result
  }

  async function updatePrefs(patch: Partial<MediaLibraryPrefs>) {
    const prefs = await ipc.updatePrefs(patch)
    overview.value = { ...overview.value, prefs }
    return prefs
  }

  const collections = computed(() => overview.value.collections)
  const tags = computed(() => overview.value.tags)
  const artists = computed(() => overview.value.artists)
  const series = computed(() => overview.value.series)
  const sources = computed(() => overview.value.sources)
  const prefs = computed(() => overview.value.prefs)
  const inboxCollections = computed(() => collections.value.filter(collection => collectionNeeds(collection).length > 0))

  function collectionById(id: string | null | undefined): CollectionSummary | undefined {
    return id ? collections.value.find(collection => collection.id === id) : undefined
  }

  function progressRatio(collection: Pick<CollectionSummary, 'progress'>): number {
    const progress = collection.progress
    if (!progress || progress.position <= 0 || progress.duration <= 0) return 0
    return Math.min(1, progress.position / progress.duration)
  }

  return {
    overview,
    collections,
    tags,
    artists,
    series,
    sources,
    prefs,
    endpoint,
    busy,
    scanProgress,
    scanLog,
    ready,
    importSession,
    inboxCollections,
    init,
    dispose,
    applyOverview,
    refresh,
    resetImport,
    pickFolder: ipc.pickFolder,
    scan,
    cancelScan: ipc.cancelScan,
    commitImport,
    getCollection: ipc.getCollection,
    updateCollection,
    removeCollection,
    rescanCollection,
    saveProgress,
    fillItemMeta,
    createTag,
    deleteTag,
    updateArtist,
    createSeries,
    updateSeries,
    deleteSeries,
    addToSeries,
    removeFromSeries,
    rescanSource,
    removeSource,
    checkSources,
    rescanAll,
    revealInFolder: ipc.revealInFolder,
    openExternally: ipc.openExternally,
    clearThumbs: ipc.clearThumbs,
    exportMeta: ipc.exportMeta,
    updatePrefs,
    collectionById,
    progressRatio,
  }
})
