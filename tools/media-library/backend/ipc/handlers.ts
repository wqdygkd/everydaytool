import type { ArtistUpdateRequest, CollectionPatch, ImportCommitRequest, MediaLibraryPrefs, ScanOptions } from '../../../../shared/media-library.ts'
import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { DEFAULT_SCAN_OPTIONS } from '../../../../shared/media-library.ts'
import {
  addToSeries,
  cancelScan,
  checkSources,
  commitImport,
  configureLibraryEvents,
  createSeries,
  createTag,
  deleteSeries,
  deleteTag,
  exportMetadata,
  fillItemMeta,
  getCollection,
  getOverview,
  getScanLog,
  itemAbsolutePath,
  removeCollection,
  removeFromSeries,
  removeSource,
  rescanAll,
  rescanCollection,
  rescanSource,
  saveProgress,
  startScan,
  updateArtist,
  updateCollection,
  updatePrefs,
  updateSeries,
} from '../library.ts'
import { acquireMediaEndpoint, releaseMediaEndpoint } from '../media-server.ts'
import { ScanCancelledError } from '../scanner.ts'
import { isCollectionId, readCollection, readIndex } from '../store.ts'
import { clearThumbs } from '../thumbs.ts'
import { MEDIA_LIBRARY_IPC_CHANNELS as CH } from './channels.ts'

let handlersRegistered = false

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asScanOptions(value: unknown): ScanOptions {
  const raw = asRecord(value)
  return {
    video: raw.video === undefined ? DEFAULT_SCAN_OPTIONS.video : raw.video === true,
    image: raw.image === undefined ? DEFAULT_SCAN_OPTIONS.image : raw.image === true,
    recursive: raw.recursive === undefined ? DEFAULT_SCAN_OPTIONS.recursive : raw.recursive === true,
    hidden: raw.hidden === true,
  }
}

function asStringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined
}

function asPatch(value: unknown): CollectionPatch {
  const raw = asRecord(value)
  const patch: CollectionPatch = {}
  if (typeof raw.title === 'string') patch.title = raw.title
  if (typeof raw.year === 'string') patch.year = raw.year
  if (typeof raw.description === 'string') patch.description = raw.description
  const artists = asStringList(raw.artists)
  if (artists) patch.artists = artists
  const tags = asStringList(raw.tags)
  if (tags) patch.tags = tags
  if (raw.coverItemId === null || typeof raw.coverItemId === 'string') patch.coverItemId = raw.coverItemId
  return patch
}

/** 把「合集 id（+ 条目 id）」解析成磁盘路径：渲染层从不直接传路径给 shell */
function resolveTarget(value: unknown): string {
  const raw = asRecord(value)
  if (typeof raw.sourceId === 'string') {
    const source = readIndex().sources.find(item => item.id === raw.sourceId)
    if (!source) throw new Error('来源不存在')
    return source.path
  }
  if (!isCollectionId(raw.collectionId)) throw new Error('合集 id 不合法')
  const doc = readCollection(raw.collectionId)
  if (!doc) throw new Error('合集不存在或已被移除')
  if (typeof raw.itemId !== 'string') return doc.rootPath
  const item = doc.items.find(entry => entry.id === raw.itemId)
  const target = item ? itemAbsolutePath(doc, item) : null
  if (!target) throw new Error('条目不存在')
  return target
}

export function registerMediaLibraryHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  configureLibraryEvents({
    progress: progress => broadcastToWindows(CH.EVENT_SCAN_PROGRESS, progress),
    busy: state => broadcastToWindows(CH.EVENT_BUSY, state),
  })

  safeHandle(ipcMain, CH.GET_OVERVIEW, () => getOverview())
  safeHandle(ipcMain, CH.MEDIA_ACQUIRE, () => acquireMediaEndpoint())
  safeHandle(ipcMain, CH.MEDIA_RELEASE, () => releaseMediaEndpoint())

  safeHandle(ipcMain, CH.PICK_FOLDER, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { title: '选择要导入的文件夹', properties: ['openDirectory' as const] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  safeHandle(ipcMain, CH.SCAN_START, async (_event, value: unknown) => {
    const raw = asRecord(value)
    if (typeof raw.scanId !== 'string' || !/^[a-z0-9]{6,40}$/.test(raw.scanId)) throw new Error('扫描 id 不合法')
    if (typeof raw.path !== 'string' || !raw.path.trim()) throw new Error('请先选择一个文件夹')
    try {
      return await startScan(raw.scanId, raw.path, asScanOptions(raw.options))
    } catch (error) {
      // 用户主动取消不是错误：返回 null，渲染层据此回到设置步骤
      if (error instanceof ScanCancelledError) return null
      throw error
    }
  })
  safeHandle(ipcMain, CH.SCAN_CANCEL, (_event, scanId: unknown) => {
    if (typeof scanId === 'string') cancelScan(scanId)
  })
  safeHandle(ipcMain, CH.IMPORT_COMMIT, (_event, request: unknown) => commitImport(request as ImportCommitRequest))

  safeHandle(ipcMain, CH.COLLECTION_GET, (_event, id: unknown) => getCollection(id))
  safeHandle(ipcMain, CH.COLLECTION_UPDATE, (_event, id: unknown, patch: unknown) => updateCollection(id, asPatch(patch)))
  safeHandle(ipcMain, CH.COLLECTION_REMOVE, (_event, id: unknown) => removeCollection(id))
  safeHandle(ipcMain, CH.COLLECTION_RESCAN, (_event, id: unknown) => rescanCollection(id))
  safeHandle(ipcMain, CH.PROGRESS_SAVE, (_event, value: unknown) => {
    const raw = asRecord(value)
    saveProgress(raw.collectionId, raw.itemId, raw.position, raw.duration)
  })
  safeHandle(ipcMain, CH.ITEM_META, (_event, value: unknown) => {
    const raw = asRecord(value)
    return fillItemMeta(raw.collectionId, raw.itemId, raw)
  })

  safeHandle(ipcMain, CH.TAG_CREATE, (_event, name: unknown) => createTag(name))
  safeHandle(ipcMain, CH.TAG_DELETE, (_event, name: unknown) => deleteTag(name))
  safeHandle(ipcMain, CH.ARTIST_UPDATE, (_event, request: unknown) => updateArtist(asRecord(request) as unknown as ArtistUpdateRequest))

  safeHandle(ipcMain, CH.SERIES_CREATE, (_event, value: unknown) => {
    const raw = asRecord(value)
    return createSeries(raw.name, raw.description)
  })
  safeHandle(ipcMain, CH.SERIES_UPDATE, (_event, value: unknown) => {
    const raw = asRecord(value)
    return updateSeries(raw.id, raw.name, raw.description)
  })
  safeHandle(ipcMain, CH.SERIES_DELETE, (_event, id: unknown) => deleteSeries(id))
  safeHandle(ipcMain, CH.SERIES_ADD, (_event, value: unknown) => {
    const raw = asRecord(value)
    return addToSeries(raw.id, raw.collectionIds)
  })
  safeHandle(ipcMain, CH.SERIES_REMOVE_ITEM, (_event, value: unknown) => {
    const raw = asRecord(value)
    return removeFromSeries(raw.id, raw.collectionId)
  })

  safeHandle(ipcMain, CH.SOURCE_RESCAN, (_event, id: unknown) => rescanSource(id))
  safeHandle(ipcMain, CH.SOURCE_REMOVE, (_event, id: unknown) => removeSource(id))
  safeHandle(ipcMain, CH.SOURCES_CHECK, () => checkSources())
  safeHandle(ipcMain, CH.RESCAN_ALL, () => rescanAll())
  safeHandle(ipcMain, CH.SCAN_LOG, () => getScanLog())

  safeHandle(ipcMain, CH.REVEAL, (_event, value: unknown) => {
    shell.showItemInFolder(resolveTarget(value))
  })
  safeHandle(ipcMain, CH.OPEN_EXTERNAL, async (_event, value: unknown) => {
    const raw = asRecord(value)
    // 只允许交给系统打开「具体的媒体条目」，不接受目录或任意路径
    if (typeof raw.itemId !== 'string') throw new Error('缺少条目 id')
    const error = await shell.openPath(resolveTarget(raw))
    if (error) throw new Error(`无法用外部应用打开：${error}`)
  })

  safeHandle(ipcMain, CH.THUMBS_CLEAR, () => clearThumbs())
  safeHandle(ipcMain, CH.EXPORT_META, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: '导出媒体库元信息',
      defaultPath: `media-library-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, `${JSON.stringify(exportMetadata(), null, 2)}\n`, 'utf8')
    return result.filePath
  })
  safeHandle(ipcMain, CH.PREFS_UPDATE, (_event, patch: unknown) => updatePrefs(asRecord(patch) as Partial<MediaLibraryPrefs>))
}
