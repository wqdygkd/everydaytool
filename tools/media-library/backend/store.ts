// 媒体库的落盘层：路径解析 + 四类 JSON 文档的读写。
//
// - `<data>/config/media-library/index.json`        合集摘要 / 标签 / 来源 / 界面偏好
// - `<data>/config/media-library/artists.json`      艺人资料
// - `<data>/config/media-library/series.json`       系列
// - `<data>/config/media-library/collections/<id>.json`  单个合集的条目与卡片根
// - `<data>/cache/media-library/{thumbs,scans}`     可再生
//
// 原文件永远只读：这里没有任何指向用户媒体目录的写入。
import type {
  ArtistProfile,
  CollectionHistoryEntry,
  CollectionSummary,
  MediaItem,
  MediaLibraryPrefs,
  ScanLogEntry,
  SeriesRecord,
  SourceRecord,
  TagRecord,
} from '../../../shared/media-library.ts'
import { rmSync } from 'node:fs'
import { readJsonDocument, writeJsonDocument } from '../../../backend/utils/json-store.ts'
import { resolveLayerPath } from '../../../backend/utils/data-layers.ts'
import { DEFAULT_PREFS } from '../../../shared/media-library.ts'

const TOOL_DIR = 'media-library'

export interface IndexDocument {
  version: 1
  collections: CollectionSummary[]
  tags: TagRecord[]
  sources: SourceRecord[]
  prefs: MediaLibraryPrefs
}

export interface ArtistsDocument {
  version: 1
  artists: ArtistProfile[]
}

export interface SeriesDocument {
  version: 1
  series: SeriesRecord[]
}

export interface CollectionDocument {
  version: 1
  id: string
  rootPath: string
  /** 相对 rootPath 的排除子目录（`/` 分隔） */
  excludedPaths: string[]
  items: MediaItem[]
  history: CollectionHistoryEntry[]
}

interface ScanLogDocument {
  version: 1
  entries: ScanLogEntry[]
}

const SCAN_LOG_LIMIT = 40
const HISTORY_LIMIT = 30

function indexPath(): string {
  return resolveLayerPath('config', TOOL_DIR, 'index.json')
}

function artistsPath(): string {
  return resolveLayerPath('config', TOOL_DIR, 'artists.json')
}

function seriesPath(): string {
  return resolveLayerPath('config', TOOL_DIR, 'series.json')
}

/** 合集 id 只允许我们自己生成的字符集：它会进入文件名 */
export function isCollectionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9]{6,40}$/.test(value)
}

function collectionPath(id: string): string {
  if (!isCollectionId(id)) throw new Error('合集 id 不合法')
  return resolveLayerPath('config', TOOL_DIR, 'collections', `${id}.json`)
}

export function thumbsRoot(): string {
  return resolveLayerPath('cache', TOOL_DIR, 'thumbs')
}

function scanLogPath(): string {
  return resolveLayerPath('cache', TOOL_DIR, 'scans', 'log.json')
}

export function readIndex(): IndexDocument {
  const doc = readJsonDocument<IndexDocument>(indexPath(), () => ({
    version: 1,
    collections: [],
    tags: [],
    sources: [],
    prefs: { ...DEFAULT_PREFS },
  }))
  // 手工改坏 / 旧版本缺字段时补齐，避免渲染层逐处判空
  if (!Array.isArray(doc.collections)) doc.collections = []
  if (!Array.isArray(doc.tags)) doc.tags = []
  if (!Array.isArray(doc.sources)) doc.sources = []
  doc.prefs = { ...DEFAULT_PREFS, ...(doc.prefs ?? {}) }
  return doc
}

export function writeIndex(doc: IndexDocument): void {
  writeJsonDocument(indexPath(), doc)
}

export function readArtists(): ArtistsDocument {
  const doc = readJsonDocument<ArtistsDocument>(artistsPath(), () => ({ version: 1, artists: [] }))
  if (!Array.isArray(doc.artists)) doc.artists = []
  return doc
}

export function writeArtists(doc: ArtistsDocument): void {
  writeJsonDocument(artistsPath(), doc)
}

export function readSeries(): SeriesDocument {
  const doc = readJsonDocument<SeriesDocument>(seriesPath(), () => ({ version: 1, series: [] }))
  if (!Array.isArray(doc.series)) doc.series = []
  return doc
}

export function writeSeries(doc: SeriesDocument): void {
  writeJsonDocument(seriesPath(), doc)
}

export function readCollection(id: string): CollectionDocument | null {
  const doc = readJsonDocument<CollectionDocument | null>(collectionPath(id), () => null)
  if (!doc || !Array.isArray(doc.items)) return null
  if (!Array.isArray(doc.excludedPaths)) doc.excludedPaths = []
  if (!Array.isArray(doc.history)) doc.history = []
  return doc
}

export function writeCollection(doc: CollectionDocument): void {
  if (doc.history.length > HISTORY_LIMIT) doc.history = doc.history.slice(0, HISTORY_LIMIT)
  writeJsonDocument(collectionPath(doc.id), doc)
}

export function deleteCollection(id: string): void {
  const file = collectionPath(id)
  // json-store 的缓存以路径为键：写一份 null 让后续读取命中「不存在」，再删文件
  writeJsonDocument<CollectionDocument | null>(file, null)
  rmSync(file, { force: true })
}

export function readScanLog(): ScanLogEntry[] {
  const doc = readJsonDocument<ScanLogDocument>(scanLogPath(), () => ({ version: 1, entries: [] }))
  return Array.isArray(doc.entries) ? doc.entries : []
}

export function appendScanLog(entry: ScanLogEntry): void {
  const entries = [entry, ...readScanLog()].slice(0, SCAN_LOG_LIMIT)
  try {
    writeJsonDocument<ScanLogDocument>(scanLogPath(), { version: 1, entries })
  } catch {
    // 扫描记录在缓存层：写失败不影响索引本身
  }
}
