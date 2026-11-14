// 媒体库业务层：导入 / 重新扫描 / 元信息编辑 / 艺人 / 系列 / 标签 / 来源。
//
// 不变量（docs/media-library.md）：
// - 原文件只读：这里对用户目录只有 readdir / stat / 读文件头；
// - 卡片根互不嵌套，排除目录必须在卡片根内部（渲染层点过一遍，这里落盘前再校验一遍）；
// - 移出资料库只删索引与缩略图，并在同一次写入里把合集从所有系列中摘掉；
// - 源文件缺失只标记，不删条目。
import type {
  ArtistProfile,
  ArtistUpdateRequest,
  ArtistUpdateResult,
  BusyState,
  CollectionDetail,
  CollectionPatch,
  CollectionSummary,
  ImportCommitRequest,
  ImportCommitResult,
  ImportSelection,
  MediaItem,
  MediaLibraryOverview,
  MediaLibraryPrefs,
  RescanResult,
  RescanSummary,
  ScanLogEntry,
  ScanOptions,
  ScanProgress,
  ScanResult,
  SeriesRecord,
  SourceRecord,
} from '../../../shared/media-library.ts'
import type { CollectionDocument, IndexDocument } from './store.ts'
import type { ScannedFile, WalkResult } from './scanner.ts'
import { randomBytes } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { comparePaths, isPathWithin, isSamePath } from '../../../backend/utils/path-guard.ts'
import {
  artistMatchesName,
  artistNameKey,
  canonicalArtistNames,
  collectionKindOf,
  DEFAULT_SCAN_OPTIONS,
  findArtistByName,
  findScanNode,
  includedScanStats,
  normalizeTagName,
  planArtistMerge,
  resolutionLabel,
  stableHash,
  uniqueTagNames,
  validateImportCards,
} from '../../../shared/media-library.ts'
import { probeMedia } from './probe.ts'
import { collectFiles, mapLimit, walkMediaTree } from './scanner.ts'
import {
  appendScanLog,
  deleteCollection,
  isCollectionId,
  readArtists,
  readCollection,
  readIndex,
  readScanLog,
  readSeries,
  writeArtists,
  writeCollection,
  writeIndex,
  writeSeries,
} from './store.ts'
import { removeThumbs, thumbKey } from './thumbs.ts'

const PROBE_CONCURRENCY = 6
const PALETTE_COUNT = 10
/** 播放到这个比例以后视为「已看完」，下次从头开始 */
const WATCHED_RATIO = 0.92

interface ScanSession {
  scanId: string
  rootPath: string
  options: ScanOptions
  cancelled: boolean
  walk: WalkResult | null
}

const scanSessions = new Map<string, ScanSession>()

let emitProgress: (progress: ScanProgress) => void = () => {}
let emitBusy: (state: BusyState) => void = () => {}
let busy = false

export function configureLibraryEvents(handlers: {
  progress: (progress: ScanProgress) => void
  busy: (state: BusyState) => void
}): void {
  emitProgress = handlers.progress
  emitBusy = handlers.busy
}

function newId(): string {
  return randomBytes(6).toString('hex')
}

function nowIso(): string {
  return new Date().toISOString()
}

function absOf(root: string, rel: string): string {
  return rel ? path.join(root, ...rel.split('/')) : root
}

export function itemAbsolutePath(doc: CollectionDocument, item: MediaItem): string | null {
  const target = absOf(doc.rootPath, item.relPath)
  return isPathWithin(doc.rootPath, target).ok ? target : null
}

async function withBusy<T>(label: string, task: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('正在扫描，请等当前任务完成')
  busy = true
  emitBusy({ busy: true, label })
  try {
    return await task()
  } finally {
    busy = false
    emitBusy({ busy: false, label: '' })
  }
}

// ── 概览 ────────────────────────────────────────────────────────

export function getOverview(): MediaLibraryOverview {
  const index = readIndex()
  return {
    collections: index.collections,
    tags: index.tags,
    artists: readArtists().artists,
    series: readSeries().series,
    sources: index.sources,
    prefs: index.prefs,
  }
}

function requireSummary(index: IndexDocument, id: unknown): CollectionSummary {
  if (!isCollectionId(id)) throw new Error('合集 id 不合法')
  const summary = index.collections.find(item => item.id === id)
  if (!summary) throw new Error('合集不存在或已被移除')
  return summary
}

function requireDocument(summary: CollectionSummary): CollectionDocument {
  return readCollection(summary.id)
    ?? { version: 1, id: summary.id, rootPath: summary.rootPath, excludedPaths: [], items: [], history: [] }
}

export function getCollection(id: unknown): CollectionDetail {
  const summary = requireSummary(readIndex(), id)
  const doc = requireDocument(summary)
  return { summary, items: doc.items, excludedPaths: doc.excludedPaths, history: doc.history }
}

/** 由条目重算摘要里的派生字段（数量 / 体积 / 封面 / 分辨率 / 进度有效性） */
function refreshSummary(summary: CollectionSummary, doc: CollectionDocument): void {
  const live = doc.items.filter(item => !item.missing)
  const videos = live.filter(item => item.kind === 'video')
  const images = live.filter(item => item.kind === 'image')

  summary.videos = videos.length
  summary.images = images.length
  summary.bytes = live.reduce((sum, item) => sum + item.size, 0)
  summary.duration = Math.round(videos.reduce((sum, item) => sum + (item.duration ?? 0), 0))
  summary.missing = doc.items.length - live.length
  if (live.length) summary.kind = collectionKindOf(videos.length, images.length)

  const currentCover = summary.coverItemId ? live.find(item => item.id === summary.coverItemId) : undefined
  const cover = summary.coverCustom && currentCover ? currentCover : (videos[0] ?? images[0])
  if (!currentCover || !summary.coverCustom) summary.coverCustom = false
  summary.coverItemId = cover?.id ?? null
  summary.coverVersion = cover?.mtimeMs ?? 0
  summary.previewImageIds = images.slice(0, 4).map(item => item.id)

  const sizedVideo = videos.find(item => item.width && item.height)
  const sizedImage = images.find(item => item.width && item.height)
  summary.resolution = sizedVideo
    ? resolutionLabel(sizedVideo.width, sizedVideo.height)
    : sizedImage ? `${sizedImage.width} × ${sizedImage.height}` : ''

  if (summary.progress && !live.some(item => item.id === summary.progress?.itemId)) summary.progress = null
}

// ── 扫描（只读）────────────────────────────────────────────────

export async function startScan(scanId: string, rootPath: string, options: ScanOptions): Promise<ScanResult> {
  const resolved = path.resolve(rootPath)
  const info = await stat(resolved).catch(() => null)
  if (!info?.isDirectory()) throw new Error('文件夹不存在或无法访问')
  if (!options.video && !options.image) throw new Error('至少选择一种媒体类型')

  const session: ScanSession = { scanId, rootPath: resolved, options, cancelled: false, walk: null }
  scanSessions.set(scanId, session)
  const startedAt = Date.now()
  let lastEmit = 0

  try {
    const walk = await walkMediaTree(resolved, {
      scan: options,
      isCancelled: () => session.cancelled,
      onProgress: ({ files, folders, current }) => {
        const now = Date.now()
        if (now - lastEmit < 90) return
        lastEmit = now
        emitProgress({ scanId, phase: 'enumerate', percent: -1, files, folders, current })
      },
    })
    session.walk = walk
    emitProgress({ scanId, phase: 'tree', percent: 100, files: walk.files, folders: walk.folders, current: '' })
    // 只保留最近两次扫描结果：整棵文件清单常驻内存没有意义
    for (const key of [...scanSessions.keys()].slice(0, -2)) scanSessions.delete(key)
    return { scanId, rootPath: resolved, options, tree: walk.tree, folders: walk.folders, elapsedMs: Date.now() - startedAt }
  } catch (error) {
    scanSessions.delete(scanId)
    throw error
  }
}

export function cancelScan(scanId: string): void {
  const session = scanSessions.get(scanId)
  if (session) session.cancelled = true
}

interface BuiltItems {
  items: MediaItem[]
  added: number
  modified: number
  missing: number
}

/** 把一次遍历得到的文件清单与已有条目对账：新增 / 变更重新探测，消失的只标记缺失 */
async function buildItems(absRoot: string, files: readonly ScannedFile[], previous: readonly MediaItem[], onProbe: (name: string) => void): Promise<BuiltItems> {
  const previousByPath = new Map(previous.map(item => [item.relPath, item]))
  const seen = new Set<string>()
  const now = nowIso()
  let added = 0
  let modified = 0
  let missing = 0

  const items = await mapLimit(files, PROBE_CONCURRENCY, async (file): Promise<MediaItem> => {
    seen.add(file.relPath)
    const prev = previousByPath.get(file.relPath)
    if (prev && prev.size === file.size && prev.mtimeMs === file.mtimeMs) {
      if (!prev.missing) return prev
      // 之前缺失、现在原样回来了：算一次变更
      modified++
      const { missing: _missing, ...restored } = prev
      return restored
    }
    const probe = await probeMedia(absOf(absRoot, file.relPath), file.kind, file.size)
    onProbe(file.name)
    if (prev) {
      modified++
      const { missing: _missing, width: _w, height: _h, duration: _d, ...kept } = prev
      return { ...kept, kind: file.kind, name: file.name, size: file.size, mtimeMs: file.mtimeMs, ...probe }
    }
    added++
    return {
      id: newId(),
      kind: file.kind,
      relPath: file.relPath,
      name: file.name,
      size: file.size,
      mtimeMs: file.mtimeMs,
      ...probe,
      addedAt: now,
    }
  })

  for (const prev of previous) {
    if (seen.has(prev.relPath)) continue
    if (!prev.missing) missing++
    items.push({ ...prev, missing: true })
  }
  items.sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh', { numeric: true }))
  return { items, added, modified, missing }
}

function changeText(result: { added: number, modified: number, missing: number }): string {
  const parts: string[] = []
  if (result.added) parts.push(`新增 ${result.added}`)
  if (result.modified) parts.push(`变更 ${result.modified}`)
  if (result.missing) parts.push(`缺失 ${result.missing}`)
  return parts.length ? parts.join(' · ') : '没有变化'
}

function logScan(sourceLabel: string, text: string, tone: ScanLogEntry['tone'] = 'ok'): void {
  appendScanLog({ at: nowIso(), sourceLabel, text, tone })
}

// ── 导入确认 → 落盘 ─────────────────────────────────────────────

interface PlannedCard {
  absRoot: string
  excluded: string[]
  files: ScannedFile[]
  existing: CollectionSummary | null
}

export async function commitImport(request: ImportCommitRequest): Promise<ImportCommitResult> {
  const session = scanSessions.get(request?.scanId)
  if (!session?.walk) throw new Error('扫描结果已过期，请重新扫描')
  const walk = session.walk
  const cards = validateImportCards(walk.tree, request.cards)

  return withBusy('正在写入索引…', async () => {
    const startedAt = Date.now()
    const index = readIndex()
    const now = nowIso()
    const rootLabel = path.basename(session.rootPath) || session.rootPath
    const conflicts: ImportCommitResult['conflicts'] = []
    const planned: PlannedCard[] = []

    for (const card of cards) {
      const absRoot = absOf(session.rootPath, card.path)
      const excludedAbs = card.excluded.map(item => absOf(session.rootPath, item))
      const label = card.path || rootLabel
      let existing: CollectionSummary | null = null
      let conflict = ''
      for (const other of index.collections) {
        const relation = comparePaths(other.rootPath, absRoot)
        if (relation.same) {
          existing = other
          continue
        }
        if (relation.inside) {
          // 新卡片落在已有合集内部：除非那一块本来就被已有合集排除了
          const otherExcluded = (readCollection(other.id)?.excludedPaths ?? []).map(item => absOf(other.rootPath, item))
          if (!otherExcluded.some(item => isPathWithin(item, absRoot).ok)) conflict = `位于已有合集「${other.title}」内部`
        } else if (comparePaths(absRoot, other.rootPath).inside) {
          if (!excludedAbs.some(item => isPathWithin(item, other.rootPath).ok)) conflict = `包含已有合集「${other.title}」，请先排除该子文件夹`
        }
      }
      if (conflict) {
        conflicts.push({ path: label, reason: conflict })
        continue
      }
      const prefix = card.path ? `${card.path}/` : ''
      const files = collectFiles(walk.filesByDir, card.path, card.excluded)
        .map(file => ({ ...file, relPath: file.relPath.slice(prefix.length) }))
      if (!files.length) {
        conflicts.push({ path: label, reason: '没有可导入的媒体文件' })
        continue
      }
      planned.push({
        absRoot,
        excluded: card.excluded.map(item => item.slice(prefix.length)),
        files,
        existing,
      })
    }

    let source = index.sources.find(item => isSamePath(item.path, session.rootPath))
    if (planned.length) {
      if (!source) {
        source = { id: newId(), label: rootLabel, path: session.rootPath, status: 'indexed', lastScanAt: now, options: session.options }
        index.sources.push(source)
      } else {
        source.options = session.options
        source.lastScanAt = now
        source.status = 'indexed'
      }
    }

    const total = planned.reduce((sum, card) => sum + card.files.length, 0)
    let done = 0
    let lastEmit = 0
    const onProbe = (name: string): void => {
      done++
      const at = Date.now()
      if (at - lastEmit < 90) return
      lastEmit = at
      emitProgress({ scanId: session.scanId, phase: 'probe', percent: total ? Math.round((done / total) * 100) : 100, files: done, folders: planned.length, current: name })
    }

    const created: string[] = []
    const updated: string[] = []
    let videos = 0
    let images = 0
    let bytes = 0

    for (const card of planned) {
      const rootInfo = await stat(card.absRoot).catch(() => null)
      const summary: CollectionSummary = card.existing ?? {
        id: newId(),
        title: path.basename(card.absRoot) || card.absRoot,
        kind: 'video',
        artists: [],
        year: '',
        tags: [],
        description: '',
        videos: 0,
        images: 0,
        bytes: 0,
        duration: 0,
        resolution: '',
        addedAt: now,
        updatedAt: now,
        lastScanAt: now,
        sourceId: source!.id,
        rootPath: card.absRoot,
        rootMtimeMs: 0,
        coverItemId: null,
        coverCustom: false,
        previewImageIds: [],
        coverVersion: 0,
        progress: null,
        missing: 0,
        fresh: true,
      }
      const doc = card.existing ? requireDocument(summary) : { version: 1 as const, id: summary.id, rootPath: card.absRoot, excludedPaths: [], items: [], history: [] }
      const built = await buildItems(card.absRoot, card.files, doc.items, onProbe)
      doc.items = built.items
      doc.excludedPaths = card.excluded
      doc.history.unshift(card.existing
        ? { at: now, kind: 'rescan', text: `再次导入：${changeText(built)}` }
        : { at: now, kind: 'import', text: `导入 ${card.files.length} 项` })

      summary.sourceId = source!.id
      summary.lastScanAt = now
      summary.rootMtimeMs = rootInfo ? Math.round(rootInfo.mtimeMs) : 0
      refreshSummary(summary, doc)
      if (!card.existing) {
        // 年份给一个可改的默认值：取最早一个文件的修改年份
        const earliest = doc.items.reduce((min, item) => Math.min(min, item.mtimeMs), Number.POSITIVE_INFINITY)
        if (Number.isFinite(earliest)) summary.year = String(new Date(earliest).getFullYear())
        index.collections.push(summary)
        created.push(summary.id)
      } else {
        updated.push(summary.id)
      }
      writeCollection(doc)
      videos += summary.videos
      images += summary.images
      bytes += summary.bytes
    }

    emitProgress({ scanId: session.scanId, phase: 'write', percent: 100, files: done, folders: planned.length, current: '' })
    writeIndex(index)

    // 「跳过的不支持文件」= 已纳入卡片范围内、扩展名不认识的文件数
    const selection: ImportSelection = { selected: new Set(cards.map(card => card.path)), excluded: new Set(cards.flatMap(card => card.excluded)) }
    const skipped = cards.reduce((sum, card) => {
      const node = findScanNode(walk.tree, card.path)
      return node ? sum + includedScanStats(selection, node).other : sum
    }, 0)

    if (planned.length) {
      const parts = [`${created.length + updated.length} 个合集`]
      if (videos) parts.push(`${videos} 视频`)
      if (images) parts.push(`${images} 图片`)
      logScan(rootLabel, `导入 ${parts.join(' · ')}`)
    }
    scanSessions.delete(session.scanId)
    emitProgress({ scanId: session.scanId, phase: 'done', percent: 100, files: done, folders: planned.length, current: '' })

    return {
      overview: getOverview(),
      created,
      updated,
      conflicts,
      videos,
      images,
      bytes,
      skipped,
      elapsedMs: Date.now() - startedAt,
    }
  })
}

// ── 重新扫描 ────────────────────────────────────────────────────

async function rescanOne(index: IndexDocument, summary: CollectionSummary): Promise<{ added: number, modified: number, missing: number }> {
  const doc = requireDocument(summary)
  const source = index.sources.find(item => item.id === summary.sourceId)
  const options = source?.options ?? DEFAULT_SCAN_OPTIONS
  const now = nowIso()
  const info = await stat(summary.rootPath).catch(() => null)
  let result = { added: 0, modified: 0, missing: 0 }

  if (!info?.isDirectory()) {
    for (const item of doc.items) {
      if (item.missing) continue
      item.missing = true
      result.missing++
    }
    doc.history.unshift({ at: now, kind: 'rescan', text: '合集目录不存在，全部条目已标记为缺失' })
  } else {
    const walk = await walkMediaTree(summary.rootPath, { scan: options, excluded: doc.excludedPaths })
    const built = await buildItems(summary.rootPath, collectFiles(walk.filesByDir, '', []), doc.items, () => {})
    doc.items = built.items
    result = { added: built.added, modified: built.modified, missing: built.missing }
    summary.rootMtimeMs = Math.round(info.mtimeMs)
    doc.history.unshift({ at: now, kind: 'rescan', text: `重新扫描：${changeText(result)}` })
  }

  summary.lastScanAt = now
  refreshSummary(summary, doc)
  writeCollection(doc)
  return result
}

async function rescanMany(targets: CollectionSummary[], label: string): Promise<RescanResult> {
  return withBusy(label, async () => {
    const index = readIndex()
    const summary: RescanSummary = { collections: targets.length, added: 0, modified: 0, missing: 0 }
    const bySource = new Map<string, { added: number, modified: number, missing: number }>()

    for (const target of targets) {
      const result = await rescanOne(index, target).catch(() => ({ added: 0, modified: 0, missing: 0 }))
      summary.added += result.added
      summary.modified += result.modified
      summary.missing += result.missing
      const bucket = bySource.get(target.sourceId) ?? { added: 0, modified: 0, missing: 0 }
      bucket.added += result.added
      bucket.modified += result.modified
      bucket.missing += result.missing
      bySource.set(target.sourceId, bucket)
    }

    const now = nowIso()
    for (const [sourceId, bucket] of bySource) {
      const source = index.sources.find(item => item.id === sourceId)
      if (!source) continue
      source.lastScanAt = now
      source.status = await sourceStatus(index, source)
      logScan(source.label, changeText(bucket), bucket.missing ? 'warn' : 'ok')
    }
    writeIndex(index)
    return { overview: getOverview(), summary }
  })
}

export function rescanCollection(id: unknown): Promise<RescanResult> {
  const summary = requireSummary(readIndex(), id)
  return rescanMany([summary], `正在扫描「${summary.title}」…`)
}

export function rescanSource(sourceId: unknown): Promise<RescanResult> {
  const index = readIndex()
  const source = index.sources.find(item => item.id === sourceId)
  if (!source) throw new Error('来源不存在')
  return rescanMany(index.collections.filter(item => item.sourceId === source.id), `正在扫描「${source.label}」…`)
}

export function rescanAll(): Promise<RescanResult> {
  return rescanMany([...readIndex().collections], '正在扫描全部来源…')
}

async function sourceStatus(index: IndexDocument, source: SourceRecord): Promise<SourceRecord['status']> {
  const rootInfo = await stat(source.path).catch(() => null)
  if (!rootInfo?.isDirectory()) return 'missing'
  for (const summary of index.collections) {
    if (summary.sourceId !== source.id) continue
    const info = await stat(summary.rootPath).catch(() => null)
    // 目录 mtime 只反映直接子项的增删改名，足够当「可能有变更」的轻量提示
    if (!info || Math.round(info.mtimeMs) !== summary.rootMtimeMs) return 'changed'
  }
  return 'indexed'
}

/** 轻量检查各来源是否有变更（只 stat 目录，不遍历） */
export async function checkSources(): Promise<MediaLibraryOverview> {
  const index = readIndex()
  let dirty = false
  for (const source of index.sources) {
    const status = await sourceStatus(index, source)
    if (status !== source.status) {
      source.status = status
      dirty = true
    }
  }
  if (dirty) writeIndex(index)
  return getOverview()
}

// ── 合集元信息 ──────────────────────────────────────────────────

function ensureArtistProfiles(artists: ArtistProfile[], names: readonly string[]): boolean {
  let changed = false
  const now = nowIso()
  for (const name of names) {
    if (findArtistByName(artists, name)) continue
    artists.push({ id: newId(), name, aliases: [], bio: '', color: stableHash(name) % PALETTE_COUNT, createdAt: now, updatedAt: now })
    changed = true
  }
  return changed
}

/** 自动建出来、又不再被任何合集使用的空资料不留着占位 */
function pruneArtistProfiles(artists: ArtistProfile[], collections: readonly CollectionSummary[]): ArtistProfile[] {
  return artists.filter(profile =>
    profile.aliases.length > 0
    || profile.bio.trim().length > 0
    || collections.some(summary => summary.artists.some(name => artistMatchesName(profile, name))))
}

function ensureTags(index: IndexDocument, names: readonly string[]): void {
  const now = nowIso()
  for (const name of names) {
    const key = name.toLocaleLowerCase()
    if (!index.tags.some(tag => tag.name.toLocaleLowerCase() === key)) index.tags.push({ name, createdAt: now })
  }
}

export function updateCollection(id: unknown, patch: CollectionPatch): MediaLibraryOverview {
  const index = readIndex()
  const summary = requireSummary(index, id)
  const doc = requireDocument(summary)
  const artistsDoc = readArtists()
  const now = nowIso()

  if (patch.title !== undefined) {
    const title = String(patch.title).trim()
    if (!title) throw new Error('标题不能为空')
    summary.title = title.slice(0, 200)
  }
  if (patch.artists !== undefined) {
    summary.artists = canonicalArtistNames(artistsDoc.artists, patch.artists.map(name => String(name).slice(0, 80)))
    ensureArtistProfiles(artistsDoc.artists, summary.artists)
  }
  if (patch.tags !== undefined) {
    summary.tags = uniqueTagNames(patch.tags.map(name => String(name).slice(0, 40)))
    ensureTags(index, summary.tags)
  }
  if (patch.year !== undefined) summary.year = String(patch.year).trim().slice(0, 12)
  if (patch.description !== undefined) summary.description = String(patch.description).trim().slice(0, 4000)
  if (patch.coverItemId !== undefined) {
    if (patch.coverItemId === null) {
      summary.coverCustom = false
    } else {
      const cover = doc.items.find(item => item.id === patch.coverItemId && !item.missing)
      if (!cover) throw new Error('封面条目不存在')
      summary.coverItemId = cover.id
      summary.coverCustom = true
    }
  }

  summary.fresh = false
  summary.updatedAt = now
  refreshSummary(summary, doc)
  doc.history.unshift({ at: now, kind: 'edit', text: '更新元信息' })
  writeCollection(doc)

  artistsDoc.artists = pruneArtistProfiles(artistsDoc.artists, index.collections)
  writeArtists(artistsDoc)
  writeIndex(index)
  return getOverview()
}

/** 从资料库移除一批合集：索引、合集文档、缩略图、系列引用一并处理；原文件不动 */
function removeCollectionsInternal(index: IndexDocument, ids: readonly string[]): void {
  const removing = new Set(ids)
  const thumbKeys: string[] = []
  for (const id of removing) {
    const doc = readCollection(id)
    if (doc) {
      for (const item of doc.items) {
        const abs = itemAbsolutePath(doc, item)
        if (abs) thumbKeys.push(thumbKey(abs, item.size, item.mtimeMs))
      }
    }
    deleteCollection(id)
  }
  index.collections = index.collections.filter(summary => !removing.has(summary.id))

  const seriesDoc = readSeries()
  let seriesDirty = false
  for (const series of seriesDoc.series) {
    const kept = series.collectionIds.filter(id => !removing.has(id))
    if (kept.length !== series.collectionIds.length) {
      series.collectionIds = kept
      seriesDirty = true
    }
  }
  if (seriesDirty) writeSeries(seriesDoc)

  const artistsDoc = readArtists()
  const pruned = pruneArtistProfiles(artistsDoc.artists, index.collections)
  if (pruned.length !== artistsDoc.artists.length) {
    artistsDoc.artists = pruned
    writeArtists(artistsDoc)
  }
  void removeThumbs(thumbKeys)
}

export function removeCollection(id: unknown): MediaLibraryOverview {
  const index = readIndex()
  const summary = requireSummary(index, id)
  removeCollectionsInternal(index, [summary.id])
  writeIndex(index)
  return getOverview()
}

export function saveProgress(collectionId: unknown, itemId: unknown, position: unknown, duration: unknown): void {
  const index = readIndex()
  const summary = requireSummary(index, collectionId)
  const doc = requireDocument(summary)
  const item = doc.items.find(entry => entry.id === itemId && entry.kind === 'video')
  if (!item) return
  const total = Number(duration)
  const at = Math.max(0, Number(position) || 0)
  if (!Number.isFinite(total) || total <= 0) return

  const finished = at / total >= WATCHED_RATIO
  if (finished) item.watched = true
  item.position = finished ? 0 : Math.round(at * 10) / 10
  if (!item.duration) item.duration = Math.round(total * 10) / 10
  summary.progress = { itemId: item.id, position: item.position, duration: Math.round(total * 10) / 10, updatedAt: nowIso() }
  writeCollection(doc)
  writeIndex(index)
}

/** 播放器 / 图片加载后回填探测不到的宽高与时长 */
export function fillItemMeta(collectionId: unknown, itemId: unknown, meta: { width?: unknown, height?: unknown, duration?: unknown }): CollectionSummary | null {
  const index = readIndex()
  const summary = requireSummary(index, collectionId)
  const doc = requireDocument(summary)
  const item = doc.items.find(entry => entry.id === itemId)
  if (!item) return null
  let changed = false
  const width = Math.round(Number(meta.width))
  const height = Math.round(Number(meta.height))
  const duration = Number(meta.duration)
  if ((!item.width || !item.height) && width > 0 && height > 0 && width < 100000 && height < 100000) {
    item.width = width
    item.height = height
    changed = true
  }
  if (!item.duration && item.kind === 'video' && Number.isFinite(duration) && duration > 0) {
    item.duration = Math.round(duration * 10) / 10
    changed = true
  }
  if (!changed) return null
  refreshSummary(summary, doc)
  writeCollection(doc)
  writeIndex(index)
  return summary
}

// ── 标签 ────────────────────────────────────────────────────────

export function createTag(name: unknown): MediaLibraryOverview {
  const clean = normalizeTagName(String(name ?? '')).slice(0, 40)
  if (!clean) throw new Error('标签名不能为空')
  const index = readIndex()
  const key = clean.toLocaleLowerCase()
  if (index.tags.some(tag => tag.name.toLocaleLowerCase() === key)
    || index.collections.some(summary => summary.tags.some(tag => tag.toLocaleLowerCase() === key))) {
    throw new Error(`标签「${clean}」已存在`)
  }
  index.tags.push({ name: clean, createdAt: nowIso() })
  writeIndex(index)
  return getOverview()
}

/** 只允许删除没有合集在用的标签：在用的标签要先从合集上摘掉 */
export function deleteTag(name: unknown): MediaLibraryOverview {
  const key = normalizeTagName(String(name ?? '')).toLocaleLowerCase()
  const index = readIndex()
  if (index.collections.some(summary => summary.tags.some(tag => tag.toLocaleLowerCase() === key))) {
    throw new Error('仍有合集在使用这个标签')
  }
  index.tags = index.tags.filter(tag => tag.name.toLocaleLowerCase() !== key)
  writeIndex(index)
  return getOverview()
}

// ── 艺人 ────────────────────────────────────────────────────────

export function updateArtist(request: ArtistUpdateRequest): ArtistUpdateResult {
  const artistsDoc = readArtists()
  const current = artistsDoc.artists.find(profile => profile.id === request?.id)
  if (!current) throw new Error('艺人不存在')
  const name = String(request.name ?? '').trim().slice(0, 80)
  if (!name) throw new Error('名字不能为空')
  const aliases = Array.isArray(request.aliases) ? request.aliases.map(alias => String(alias).slice(0, 80)) : []

  const plan = planArtistMerge(artistsDoc.artists, current.id, name, aliases)
  const mergedIds = new Set(plan.merged.map(profile => profile.id))
  // 合集上所有指向「当前资料旧名 / 旧别名 / 被并入者」的署名统一改写成新名字
  const absorbed = new Set<string>([current.name, ...current.aliases, plan.name, ...plan.aliases].map(artistNameKey))

  const bio = String(request.bio ?? '').trim().slice(0, 2000)
  current.name = plan.name
  current.aliases = plan.aliases
  current.bio = bio || plan.merged.map(profile => profile.bio.trim()).find(Boolean) || ''
  current.updatedAt = nowIso()
  artistsDoc.artists = artistsDoc.artists.filter(profile => !mergedIds.has(profile.id))

  const index = readIndex()
  let indexDirty = false
  for (const summary of index.collections) {
    if (!summary.artists.some(artist => absorbed.has(artistNameKey(artist)))) continue
    const seen = new Set<string>()
    const next: string[] = []
    for (const artist of summary.artists) {
      const display = absorbed.has(artistNameKey(artist)) ? plan.name : artist
      const key = artistNameKey(display)
      if (seen.has(key)) continue
      seen.add(key)
      next.push(display)
    }
    summary.artists = next
    indexDirty = true
  }

  writeArtists(artistsDoc)
  if (indexDirty) writeIndex(index)
  return { overview: getOverview(), id: current.id, mergedNames: plan.merged.map(profile => profile.name) }
}

// ── 系列 ────────────────────────────────────────────────────────

function requireSeries(list: SeriesRecord[], id: unknown): SeriesRecord {
  const series = list.find(item => item.id === id)
  if (!series) throw new Error('系列不存在或已被删除')
  return series
}

function cleanSeriesName(value: unknown): string {
  const name = String(value ?? '').trim().slice(0, 120)
  if (!name) throw new Error('系列名称不能为空')
  return name
}

export function createSeries(name: unknown, description: unknown): { overview: MediaLibraryOverview, id: string } {
  const doc = readSeries()
  const now = nowIso()
  const series: SeriesRecord = {
    id: newId(),
    name: cleanSeriesName(name),
    description: String(description ?? '').trim().slice(0, 2000),
    collectionIds: [],
    createdAt: now,
    updatedAt: now,
  }
  doc.series.unshift(series)
  writeSeries(doc)
  return { overview: getOverview(), id: series.id }
}

export function updateSeries(id: unknown, name: unknown, description: unknown): MediaLibraryOverview {
  const doc = readSeries()
  const series = requireSeries(doc.series, id)
  series.name = cleanSeriesName(name)
  series.description = String(description ?? '').trim().slice(0, 2000)
  series.updatedAt = nowIso()
  writeSeries(doc)
  return getOverview()
}

/** 删除系列只删这条记录：合集、源文件与标签都不动 */
export function deleteSeries(id: unknown): MediaLibraryOverview {
  const doc = readSeries()
  requireSeries(doc.series, id)
  doc.series = doc.series.filter(item => item.id !== id)
  writeSeries(doc)
  return getOverview()
}

export function addToSeries(id: unknown, collectionIds: unknown): MediaLibraryOverview {
  const doc = readSeries()
  const series = requireSeries(doc.series, id)
  const known = new Set(readIndex().collections.map(summary => summary.id))
  const incoming = Array.isArray(collectionIds) ? collectionIds : []
  // 去重 + 只接受真实存在的合集；保持「先加入的在前」的顺序
  for (const value of incoming) {
    if (typeof value !== 'string' || !known.has(value) || series.collectionIds.includes(value)) continue
    series.collectionIds.push(value)
  }
  series.updatedAt = nowIso()
  writeSeries(doc)
  return getOverview()
}

export function removeFromSeries(id: unknown, collectionId: unknown): MediaLibraryOverview {
  const doc = readSeries()
  const series = requireSeries(doc.series, id)
  series.collectionIds = series.collectionIds.filter(value => value !== collectionId)
  series.updatedAt = nowIso()
  writeSeries(doc)
  return getOverview()
}

// ── 来源 ────────────────────────────────────────────────────────

/** 移除来源 = 移除它名下所有合集的索引；原文件与目录不受影响 */
export function removeSource(sourceId: unknown): MediaLibraryOverview {
  const index = readIndex()
  const source = index.sources.find(item => item.id === sourceId)
  if (!source) throw new Error('来源不存在')
  removeCollectionsInternal(index, index.collections.filter(summary => summary.sourceId === source.id).map(summary => summary.id))
  index.sources = index.sources.filter(item => item.id !== source.id)
  writeIndex(index)
  logScan(source.label, '已从媒体库移除（原文件未改动）', 'warn')
  return getOverview()
}

export function getScanLog(): ScanLogEntry[] {
  return readScanLog()
}

// ── 偏好 / 导出 ─────────────────────────────────────────────────

export function updatePrefs(patch: Partial<MediaLibraryPrefs>): MediaLibraryPrefs {
  const index = readIndex()
  const next = { ...index.prefs }
  if (patch?.view === 'grid' || patch?.view === 'list') next.view = patch.view
  if (patch?.sort === 'added' || patch?.sort === 'name' || patch?.sort === 'items' || patch?.sort === 'size') next.sort = patch.sort
  if (typeof patch?.volume === 'number' && Number.isFinite(patch.volume)) next.volume = Math.min(1, Math.max(0, patch.volume))
  if (typeof patch?.muted === 'boolean') next.muted = patch.muted
  index.prefs = next
  writeIndex(index)
  return next
}

/** 元信息整体导出：索引 + 艺人 + 系列 + 各合集条目（不含任何媒体内容） */
export function exportMetadata(): Record<string, unknown> {
  const index = readIndex()
  return {
    format: 'edt-media-library',
    version: 1,
    exportedAt: nowIso(),
    index,
    artists: readArtists().artists,
    series: readSeries().series,
    collections: index.collections.map(summary => readCollection(summary.id)).filter(Boolean),
  }
}