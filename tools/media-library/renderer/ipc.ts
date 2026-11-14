// 媒体库唯一的 IPC helper 实例：store / 页面 / 组件都从这里调用，不自行 createIpcHelpers。
import type {
  ArtistUpdateRequest,
  ArtistUpdateResult,
  BusyState,
  CollectionDetail,
  CollectionPatch,
  CollectionSummary,
  ImportCommitRequest,
  ImportCommitResult,
  MediaEndpoint,
  MediaLibraryOverview,
  MediaLibraryPrefs,
  RescanResult,
  ScanLogEntry,
  ScanOptions,
  ScanProgress,
  ScanResult,
} from '@shared/media-library'
import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'
import { MEDIA_LIBRARY_CHANNELS as CH } from '@shared/media-library'

const { invoke, on } = createIpcHelpers('mediaLibrary', '媒体库')

export const getOverview = () => invoke<MediaLibraryOverview>(CH.GET_OVERVIEW)
export const acquireMedia = () => invoke<MediaEndpoint>(CH.MEDIA_ACQUIRE)
export const releaseMedia = () => invoke<void>(CH.MEDIA_RELEASE)

export const pickFolder = () => invoke<string | null>(CH.PICK_FOLDER)
/** 返回 null 表示用户取消了扫描 */
export const startScan = (scanId: string, path: string, options: ScanOptions) => invoke<ScanResult | null>(CH.SCAN_START, { scanId, path, options })
export const cancelScan = (scanId: string) => invoke<void>(CH.SCAN_CANCEL, scanId)
export const commitImport = (request: ImportCommitRequest) => invoke<ImportCommitResult>(CH.IMPORT_COMMIT, request)

export const getCollection = (id: string) => invoke<CollectionDetail>(CH.COLLECTION_GET, id)
export const updateCollection = (id: string, patch: CollectionPatch) => invoke<MediaLibraryOverview>(CH.COLLECTION_UPDATE, id, patch)
export const removeCollection = (id: string) => invoke<MediaLibraryOverview>(CH.COLLECTION_REMOVE, id)
export const rescanCollection = (id: string) => invoke<RescanResult>(CH.COLLECTION_RESCAN, id)
export function saveProgress(collectionId: string, itemId: string, position: number, duration: number) {
  return invoke<void>(CH.PROGRESS_SAVE, { collectionId, itemId, position, duration })
}
export function fillItemMeta(collectionId: string, itemId: string, meta: { width?: number, height?: number, duration?: number }) {
  return invoke<CollectionSummary | null>(CH.ITEM_META, { collectionId, itemId, ...meta })
}

export const createTag = (name: string) => invoke<MediaLibraryOverview>(CH.TAG_CREATE, name)
export const deleteTag = (name: string) => invoke<MediaLibraryOverview>(CH.TAG_DELETE, name)
export const updateArtist = (request: ArtistUpdateRequest) => invoke<ArtistUpdateResult>(CH.ARTIST_UPDATE, request)

export const createSeries = (name: string, description: string) => invoke<{ overview: MediaLibraryOverview, id: string }>(CH.SERIES_CREATE, { name, description })
export const updateSeries = (id: string, name: string, description: string) => invoke<MediaLibraryOverview>(CH.SERIES_UPDATE, { id, name, description })
export const deleteSeries = (id: string) => invoke<MediaLibraryOverview>(CH.SERIES_DELETE, id)
export const addToSeries = (id: string, collectionIds: string[]) => invoke<MediaLibraryOverview>(CH.SERIES_ADD, { id, collectionIds })
export const removeFromSeries = (id: string, collectionId: string) => invoke<MediaLibraryOverview>(CH.SERIES_REMOVE_ITEM, { id, collectionId })

export const rescanSource = (id: string) => invoke<RescanResult>(CH.SOURCE_RESCAN, id)
export const removeSource = (id: string) => invoke<MediaLibraryOverview>(CH.SOURCE_REMOVE, id)
export const checkSources = () => invoke<MediaLibraryOverview>(CH.SOURCES_CHECK)
export const rescanAll = () => invoke<RescanResult>(CH.RESCAN_ALL)
export const getScanLog = () => invoke<ScanLogEntry[]>(CH.SCAN_LOG)

export type RevealTarget = { collectionId: string, itemId?: string } | { sourceId: string }
export const revealInFolder = (target: RevealTarget) => invoke<void>(CH.REVEAL, target)
export const openExternally = (collectionId: string, itemId: string) => invoke<void>(CH.OPEN_EXTERNAL, { collectionId, itemId })

export const clearThumbs = () => invoke<void>(CH.THUMBS_CLEAR)
export const exportMeta = () => invoke<string | null>(CH.EXPORT_META)
export const updatePrefs = (patch: Partial<MediaLibraryPrefs>) => invoke<MediaLibraryPrefs>(CH.PREFS_UPDATE, patch)

export const onScanProgress = (callback: (progress: ScanProgress) => void) => on<ScanProgress>(CH.EVENT_SCAN_PROGRESS, callback)
export const onBusy = (callback: (state: BusyState) => void) => on<BusyState>(CH.EVENT_BUSY, callback)
