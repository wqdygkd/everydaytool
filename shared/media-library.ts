/**
 * 媒体库（media-library）共享定义：IPC 通道、数据模型与**纯逻辑**。
 *
 * 渲染层与主进程共用同一份规则（导入时的卡片根 / 排除校验、艺人别名归并），
 * 所以这里只能有纯类型 / 常量 / 纯函数，不依赖 Electron、Node、文件系统。
 * 设计依据见 docs/media-library.md。
 */

// ── IPC 通道 ────────────────────────────────────────────────────

export const MEDIA_LIBRARY_CHANNELS = {
  GET_OVERVIEW: 'media-library:overview',
  MEDIA_ACQUIRE: 'media-library:media:acquire',
  MEDIA_RELEASE: 'media-library:media:release',
  PICK_FOLDER: 'media-library:pick-folder',
  SCAN_START: 'media-library:scan:start',
  SCAN_CANCEL: 'media-library:scan:cancel',
  IMPORT_COMMIT: 'media-library:import:commit',
  COLLECTION_GET: 'media-library:collection:get',
  COLLECTION_UPDATE: 'media-library:collection:update',
  COLLECTION_REMOVE: 'media-library:collection:remove',
  COLLECTION_RESCAN: 'media-library:collection:rescan',
  PROGRESS_SAVE: 'media-library:progress:save',
  ITEM_META: 'media-library:item:meta',
  TAG_CREATE: 'media-library:tag:create',
  TAG_DELETE: 'media-library:tag:delete',
  ARTIST_UPDATE: 'media-library:artist:update',
  SERIES_CREATE: 'media-library:series:create',
  SERIES_UPDATE: 'media-library:series:update',
  SERIES_DELETE: 'media-library:series:delete',
  SERIES_ADD: 'media-library:series:add',
  SERIES_REMOVE_ITEM: 'media-library:series:remove-item',
  SOURCE_RESCAN: 'media-library:source:rescan',
  SOURCE_REMOVE: 'media-library:source:remove',
  SOURCES_CHECK: 'media-library:sources:check',
  RESCAN_ALL: 'media-library:rescan-all',
  REVEAL: 'media-library:reveal',
  OPEN_EXTERNAL: 'media-library:open-external',
  THUMBS_CLEAR: 'media-library:thumbs:clear',
  EXPORT_META: 'media-library:export-meta',
  PREFS_UPDATE: 'media-library:prefs:update',
  SCAN_LOG: 'media-library:scan-log',
  EVENT_SCAN_PROGRESS: 'media-library:event:scan-progress',
  EVENT_BUSY: 'media-library:event:busy',
} as const

// ── 媒体类型 ────────────────────────────────────────────────────

export const MEDIA_VIDEO_EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'm4v'] as const
export const MEDIA_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'] as const

export type MediaKind = 'video' | 'image'
export type CollectionKind = 'video' | 'image' | 'mixed'

const VIDEO_EXT_SET = new Set<string>(MEDIA_VIDEO_EXTENSIONS)
const IMAGE_EXT_SET = new Set<string>(MEDIA_IMAGE_EXTENSIONS)

/** 扫描时无条件跳过的文件名（系统缩略图数据库 / Finder 元数据 / 回收站标记） */
const SKIPPED_FILE_NAMES = new Set(['thumbs.db', 'ehthumbs.db', 'desktop.ini', '.ds_store'])

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 文件扩展名 → 媒体类型；不认识的格式返回 null（不进入索引，但会计入「其他文件」） */
export function mediaKindOf(name: string): MediaKind | null {
  const ext = fileExtension(name)
  if (VIDEO_EXT_SET.has(ext)) return 'video'
  if (IMAGE_EXT_SET.has(ext)) return 'image'
  return null
}

/** 系统文件、临时文件：既不索引也不计入「其他文件」 */
export function isIgnoredFileName(name: string): boolean {
  const lower = name.toLowerCase()
  if (SKIPPED_FILE_NAMES.has(lower)) return true
  if (lower.startsWith('~$') || lower.startsWith('._')) return true
  return /\.(?:tmp|temp|part|partial|crdownload|download|!qb|bak~)$/.test(lower)
}

export function isHiddenName(name: string): boolean {
  return name.startsWith('.')
}

export function collectionKindOf(videos: number, images: number): CollectionKind {
  if (videos > 0 && images > 0) return 'mixed'
  return videos > 0 ? 'video' : 'image'
}

// ── 数据模型 ────────────────────────────────────────────────────

export interface MediaItem {
  id: string
  kind: MediaKind
  /** 相对合集根目录，统一用 `/` 分隔 */
  relPath: string
  name: string
  size: number
  mtimeMs: number
  width?: number
  height?: number
  /** 秒 */
  duration?: number
  /** 重新扫描时源文件已不存在：只标记，不删除条目 */
  missing?: boolean
  /** 上次播放位置（秒） */
  position?: number
  watched?: boolean
  addedAt: string
}

export interface PlaybackProgress {
  itemId: string
  position: number
  duration: number
  updatedAt: string
}

export type CollectionNeed = 'artist' | 'tags' | 'cover'

/** 合集摘要：列表 / 卡片渲染所需的一切，保存在 index.json 里 */
export interface CollectionSummary {
  id: string
  title: string
  kind: CollectionKind
  artists: string[]
  year: string
  tags: string[]
  description: string
  videos: number
  images: number
  bytes: number
  /** 所有视频时长合计（秒），未探测到时为 0 */
  duration: number
  resolution: string
  addedAt: string
  /** 最近一次元信息编辑时间（「标签 · 最近使用」据此派生） */
  updatedAt: string
  lastScanAt: string
  sourceId: string
  rootPath: string
  rootMtimeMs: number
  /** 封面条目；null 表示没有可用封面 */
  coverItemId: string | null
  /** 用户手动换过封面：重新扫描时不再自动改回首帧 / 首图 */
  coverCustom: boolean
  /** 图集 / 混合封面拼图用的前几张图片 */
  previewImageIds: string[]
  /** 用于拼接缩略图 URL 的版本戳（封面条目的 mtime），封面变化后浏览器缓存自然失效 */
  coverVersion: number
  progress: PlaybackProgress | null
  /** 源文件缺失的条目数 */
  missing: number
  /** 首次导入后尚未被用户编辑保存过 */
  fresh: boolean
}

export interface CollectionHistoryEntry {
  at: string
  kind: 'import' | 'rescan' | 'edit'
  text: string
}

export interface CollectionDetail {
  summary: CollectionSummary
  items: MediaItem[]
  excludedPaths: string[]
  history: CollectionHistoryEntry[]
}

export interface TagRecord {
  name: string
  color?: string
  group?: string
  createdAt: string
}

export interface ArtistProfile {
  id: string
  name: string
  aliases: string[]
  bio: string
  color: number
  createdAt: string
  updatedAt: string
}

export interface SeriesRecord {
  id: string
  name: string
  description: string
  collectionIds: string[]
  createdAt: string
  updatedAt: string
}

export type SourceStatus = 'indexed' | 'changed' | 'missing'

export interface SourceRecord {
  id: string
  label: string
  path: string
  status: SourceStatus
  lastScanAt: string
  options: ScanOptions
}

export interface ScanOptions {
  video: boolean
  image: boolean
  recursive: boolean
  hidden: boolean
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = { video: true, image: true, recursive: true, hidden: false }

export interface MediaLibraryPrefs {
  view: 'grid' | 'list'
  sort: LibrarySort
  volume: number
  muted: boolean
}

export type LibrarySort = 'added' | 'name' | 'items' | 'size'

export const DEFAULT_PREFS: MediaLibraryPrefs = { view: 'grid', sort: 'added', volume: 0.8, muted: false }

export interface MediaLibraryOverview {
  collections: CollectionSummary[]
  tags: TagRecord[]
  artists: ArtistProfile[]
  series: SeriesRecord[]
  sources: SourceRecord[]
  prefs: MediaLibraryPrefs
}

/** 本地媒体服务的访问入口：渲染层据此拼出缩略图 / 原文件 URL */
export interface MediaEndpoint {
  origin: string
  token: string
}

// ── 扫描与导入 ──────────────────────────────────────────────────

export interface ScanNode {
  /** 相对扫描根，`/` 分隔；根节点为空串 */
  path: string
  name: string
  /** 本目录直接包含的文件统计（不含子目录） */
  videos: number
  images: number
  other: number
  bytes: number
  children: ScanNode[]
}

export interface ScanResult {
  scanId: string
  rootPath: string
  options: ScanOptions
  tree: ScanNode
  folders: number
  elapsedMs: number
}

export type ScanPhase = 'enumerate' | 'tree' | 'probe' | 'write' | 'done'

export interface ScanProgress {
  scanId: string
  phase: ScanPhase
  /** 0–100；枚举阶段无法预知总量，保持不确定态时为 -1 */
  percent: number
  files: number
  folders: number
  current: string
}

export interface ImportCardRequest {
  /** 相对扫描根的卡片根路径（空串 = 扫描根本身） */
  path: string
  /** 相对扫描根、位于该卡片根内部的排除子目录 */
  excluded: string[]
}

export interface ImportCommitRequest {
  scanId: string
  cards: ImportCardRequest[]
}

export interface ImportCommitResult {
  overview: MediaLibraryOverview
  created: string[]
  updated: string[]
  /** 与已有合集的卡片根嵌套而被跳过的路径 */
  conflicts: Array<{ path: string, reason: string }>
  videos: number
  images: number
  bytes: number
  skipped: number
  elapsedMs: number
}

export interface RescanSummary {
  collections: number
  added: number
  modified: number
  missing: number
}

export interface RescanResult {
  overview: MediaLibraryOverview
  summary: RescanSummary
}

export interface ScanLogEntry {
  at: string
  sourceLabel: string
  text: string
  tone: 'ok' | 'warn'
}

export interface BusyState {
  busy: boolean
  label: string
}

export interface CollectionPatch {
  title?: string
  artists?: string[]
  tags?: string[]
  year?: string
  description?: string
  coverItemId?: string | null
}

export interface ArtistUpdateRequest {
  id: string
  name: string
  aliases: string[]
  bio: string
}

export interface ArtistUpdateResult {
  overview: MediaLibraryOverview
  /** 保存后仍在使用的艺人 id（合并时保留当前资料的 id） */
  id: string
  mergedNames: string[]
}

// ── 导入确认：卡片根 / 排除规则（纯逻辑，前后端共用） ──────────────

export interface ScanStats {
  videos: number
  images: number
  other: number
  bytes: number
}

const EMPTY_STATS: ScanStats = { videos: 0, images: 0, other: 0, bytes: 0 }

function addStats(target: ScanStats, next: ScanStats): ScanStats {
  target.videos += next.videos
  target.images += next.images
  target.other += next.other
  target.bytes += next.bytes
  return target
}

function subtractStats(a: ScanStats, b: ScanStats): ScanStats {
  return {
    videos: Math.max(0, a.videos - b.videos),
    images: Math.max(0, a.images - b.images),
    other: Math.max(0, a.other - b.other),
    bytes: Math.max(0, a.bytes - b.bytes),
  }
}

/** `child` 是否位于 `parent` 目录内部（不含自身）；路径为相对扫描根的 `/` 分隔形式 */
export function isPathInside(parent: string, child: string): boolean {
  if (parent === child) return false
  if (parent === '') return child !== ''
  return child.startsWith(`${parent}/`)
}

function ancestorsOf(path: string): string[] {
  if (path === '') return []
  const parts = path.split('/')
  const out: string[] = ['']
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

export interface ImportSelection {
  selected: Set<string>
  excluded: Set<string>
}

export function createImportSelection(): ImportSelection {
  return { selected: new Set(), excluded: new Set() }
}

export function selectedAncestor(selection: ImportSelection, path: string): string | null {
  const chain = ancestorsOf(path)
  for (let i = chain.length - 1; i >= 0; i--) {
    if (selection.selected.has(chain[i])) return chain[i]
  }
  return null
}

export function excludedAncestor(selection: ImportSelection, path: string): string | null {
  const chain = ancestorsOf(path)
  for (let i = chain.length - 1; i >= 0; i--) {
    if (selection.excluded.has(chain[i])) return chain[i]
  }
  return null
}

export function findScanNode(tree: ScanNode, path: string): ScanNode | null {
  if (tree.path === path) return tree
  for (const child of tree.children) {
    if (child.path === path || isPathInside(child.path, path)) return findScanNode(child, path)
  }
  return null
}

export function walkScanTree(node: ScanNode, visit: (node: ScanNode) => void): void {
  visit(node)
  for (const child of node.children) walkScanTree(child, visit)
}

/** 整棵子树的原始统计（忽略选择 / 排除状态） */
export function rawScanStats(node: ScanNode): ScanStats {
  const stats: ScanStats = { videos: node.videos, images: node.images, other: node.other, bytes: node.bytes }
  for (const child of node.children) addStats(stats, rawScanStats(child))
  return stats
}

/** 扣除排除子树后的统计 */
export function includedScanStats(selection: ImportSelection, node: ScanNode): ScanStats {
  if (selection.excluded.has(node.path) || excludedAncestor(selection, node.path) !== null) return { ...EMPTY_STATS }
  const stats: ScanStats = { videos: node.videos, images: node.images, other: node.other, bytes: node.bytes }
  for (const child of node.children) addStats(stats, includedScanStats(selection, child))
  return stats
}

export function selectedDescendantCount(selection: ImportSelection, node: ScanNode): number {
  let count = 0
  for (const child of node.children) {
    if (selection.selected.has(child.path)) count++
    count += selectedDescendantCount(selection, child)
  }
  return count
}

/** 已选卡片根，按目录树先序排列 */
export function selectedScanRoots(selection: ImportSelection, tree: ScanNode): ScanNode[] {
  const roots: ScanNode[] = []
  walkScanTree(tree, (node) => {
    if (selection.selected.has(node.path)) roots.push(node)
  })
  return roots
}

function dropInside(set: Set<string>, parent: string, includeSelf: boolean): void {
  for (const value of [...set]) {
    if ((includeSelf && value === parent) || isPathInside(parent, value)) set.delete(value)
  }
}

/**
 * 勾选 / 取消一个文件夹作为卡片根。
 * - 已是卡片根：取消，并清掉它内部的排除；
 * - 位于另一张卡片内部：无操作（卡片根不允许嵌套，内部目录只能「排除」）；
 * - 内部已有子卡片：子卡片并入本目录，合并成一张。
 */
export function toggleImportCard(selection: ImportSelection, node: ScanNode): ImportSelection {
  const next: ImportSelection = { selected: new Set(selection.selected), excluded: new Set(selection.excluded) }
  if (next.selected.has(node.path)) {
    next.selected.delete(node.path)
    dropInside(next.excluded, node.path, true)
    return next
  }
  if (selectedAncestor(next, node.path) !== null) return next
  dropInside(next.selected, node.path, false)
  // 子卡片上残留的排除仍然有效：它们现在属于合并后的这张卡片
  next.excluded.delete(node.path)
  next.selected.add(node.path)
  return next
}

/** 排除 / 恢复卡片内的一个子文件夹：整棵子树一起生效，子级上的排除被吸收 */
export function toggleImportExclude(selection: ImportSelection, node: ScanNode): ImportSelection {
  if (selectedAncestor(selection, node.path) === null) return selection
  if (excludedAncestor(selection, node.path) !== null) return selection
  const next: ImportSelection = { selected: new Set(selection.selected), excluded: new Set(selection.excluded) }
  if (next.excluded.has(node.path)) {
    next.excluded.delete(node.path)
    return next
  }
  dropInside(next.excluded, node.path, false)
  next.excluded.add(node.path)
  return next
}

function hasAnyFiles(node: ScanNode): boolean {
  const stats = rawScanStats(node)
  return stats.videos + stats.images > 0
}

/** 快捷操作「按一级文件夹」：每个含媒体的一级子目录各成一张卡片 */
export function selectTopLevelCards(tree: ScanNode): ImportSelection {
  const selection = createImportSelection()
  for (const child of tree.children) {
    if (hasAnyFiles(child)) selection.selected.add(child.path)
  }
  // 没有任何含媒体的子目录（媒体直接散落在根目录）时退回整目录一张卡片
  if (!selection.selected.size && hasAnyFiles(tree)) selection.selected.add(tree.path)
  return selection
}

/** 快捷操作「合并为一张」：只选扫描根 */
export function mergeAllCards(tree: ScanNode): ImportSelection {
  const selection = createImportSelection()
  selection.selected.add(tree.path)
  return selection
}

export interface ImportCoverage {
  total: ScanStats
  covered: ScanStats
  included: ScanStats
  excluded: ScanStats
  unassigned: ScanStats
}

export function importCoverage(selection: ImportSelection, tree: ScanNode): ImportCoverage {
  const total = rawScanStats(tree)
  const roots = selectedScanRoots(selection, tree)
  const covered = roots.reduce((stats, node) => addStats(stats, rawScanStats(node)), { ...EMPTY_STATS })
  const included = roots.reduce((stats, node) => addStats(stats, includedScanStats(selection, node)), { ...EMPTY_STATS })
  return {
    total,
    covered,
    included,
    excluded: subtractStats(covered, included),
    unassigned: subtractStats(total, covered),
  }
}

/** 把选择状态收敛成提交给后端的卡片清单 */
export function buildImportCards(selection: ImportSelection, tree: ScanNode): ImportCardRequest[] {
  return selectedScanRoots(selection, tree).map(node => ({
    path: node.path,
    excluded: [...selection.excluded].filter(path => isPathInside(node.path, path)).sort(),
  }))
}

/**
 * 后端落盘前的二次校验：卡片根必须是扫描树里的真实目录、互不嵌套，
 * 排除路径必须位于所属卡片根内部且真实存在。返回规范化后的清单；不合法直接抛错。
 */
export function validateImportCards(tree: ScanNode, cards: ImportCardRequest[]): ImportCardRequest[] {
  if (!Array.isArray(cards) || !cards.length) throw new Error('至少选择一个文件夹作为卡片')
  const seen = new Set<string>()
  const normalized: ImportCardRequest[] = []
  for (const card of cards) {
    if (!card || typeof card.path !== 'string') throw new Error('卡片路径不合法')
    if (!findScanNode(tree, card.path)) throw new Error(`卡片根不在本次扫描结果里：${card.path || '（根目录）'}`)
    if (seen.has(card.path)) throw new Error(`卡片根重复：${card.path || '（根目录）'}`)
    seen.add(card.path)
    const excluded = Array.isArray(card.excluded) ? card.excluded.filter((value): value is string => typeof value === 'string') : []
    for (const path of excluded) {
      if (!isPathInside(card.path, path)) throw new Error(`排除目录必须位于卡片内部：${path}`)
      if (!findScanNode(tree, path)) throw new Error(`排除目录不在本次扫描结果里：${path}`)
    }
    // 嵌套的排除只保留最外层：父目录排除后子目录的排除没有意义
    const outer = excluded.filter(path => !excluded.some(other => isPathInside(other, path)))
    normalized.push({ path: card.path, excluded: [...new Set(outer)].sort() })
  }
  for (const a of normalized) {
    for (const b of normalized) {
      if (a !== b && isPathInside(a.path, b.path)) {
        throw new Error(`卡片根不能嵌套：「${b.path}」位于「${a.path || '（根目录）'}」内部`)
      }
    }
  }
  return normalized
}

// ── 艺人：别名解析与合并规划 ──────────────────────────────────────

/** 姓名比较键：去首尾空白 + 不区分大小写 */
export function artistNameKey(value: string): string {
  return String(value ?? '').trim().toLocaleLowerCase()
}

/** 「别名」输入框：逗号 / 顿号 / 分号 / 换行分隔 */
export function parseAliasList(value: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of String(value ?? '').split(/[,，、;；\n]/)) {
    const name = part.trim()
    const key = artistNameKey(name)
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

export function artistMatchesName(profile: Pick<ArtistProfile, 'name' | 'aliases'>, name: string): boolean {
  const key = artistNameKey(name)
  return artistNameKey(profile.name) === key || profile.aliases.some(alias => artistNameKey(alias) === key)
}

export function findArtistByName<T extends Pick<ArtistProfile, 'name' | 'aliases'>>(artists: readonly T[], name: string): T | undefined {
  return artists.find(profile => artistMatchesName(profile, name))
}

export interface ArtistMergePlan {
  name: string
  /** 合并后的别名（不含正式名，已去重） */
  aliases: string[]
  /** 会被并入当前资料并删除的其他艺人 */
  merged: ArtistProfile[]
}

/**
 * 计算保存艺人资料时的合并结果：新名字或任一别名命中另一位艺人（名字或别名）时，
 * 那位艺人的名字 + 别名全部并入当前资料，当前资料保留自己的 id 与名字。
 */
export function planArtistMerge(artists: readonly ArtistProfile[], id: string, name: string, aliases: readonly string[]): ArtistMergePlan {
  const cleanName = name.trim()
  const names = [cleanName, ...aliases.map(alias => alias.trim()).filter(Boolean)]
  const merged: ArtistProfile[] = []
  const collected: string[] = [...names]

  // 吸收是传递的：被并入者的别名可能又命中第三位艺人
  let grew = true
  while (grew) {
    grew = false
    for (const profile of artists) {
      if (profile.id === id || merged.includes(profile)) continue
      if (collected.some(candidate => artistMatchesName(profile, candidate))) {
        merged.push(profile)
        collected.push(profile.name, ...profile.aliases)
        grew = true
      }
    }
  }

  const nameKey = artistNameKey(cleanName)
  const seen = new Set<string>([nameKey])
  const finalAliases: string[] = []
  for (const candidate of collected) {
    const key = artistNameKey(candidate)
    if (!key || seen.has(key)) continue
    seen.add(key)
    finalAliases.push(candidate.trim())
  }
  return { name: cleanName, aliases: finalAliases, merged }
}

/** 合集的署名去重：同一位艺人（名字或别名）只保留一次，统一写成正式名 */
export function canonicalArtistNames(artists: readonly ArtistProfile[], names: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const trimmed = String(raw ?? '').trim()
    if (!trimmed) continue
    const profile = findArtistByName(artists, trimmed)
    const display = profile ? profile.name : trimmed
    const key = artistNameKey(display)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(display)
  }
  return out
}

// ── 其他纯函数 ──────────────────────────────────────────────────

/** FNV-1a：海报配色 / 艺人头像色等「由 id 稳定派生」的取值 */
export function stableHash(value: string): number {
  let h = 2166136261
  const text = String(value)
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export const ARTIST_NONE_ID = '__none'

export function collectionNeeds(summary: Pick<CollectionSummary, 'artists' | 'tags' | 'coverItemId'>): CollectionNeed[] {
  const needs: CollectionNeed[] = []
  if (!summary.artists.length) needs.push('artist')
  if (!summary.tags.length) needs.push('tags')
  if (!summary.coverItemId) needs.push('cover')
  return needs
}

/** 标签名规范化：去首尾空白、压缩内部空白 */
export function normalizeTagName(value: string): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

export function uniqueTagNames(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const name = normalizeTagName(raw)
    const key = name.toLocaleLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

export function resolutionLabel(width?: number, height?: number): string {
  if (!width || !height) return ''
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (long >= 3800 || short >= 2100) return '4K'
  if (short >= 1400) return '1440p'
  if (short >= 1060) return '1080p'
  if (short >= 700) return '720p'
  if (short >= 460) return '480p'
  return `${width} × ${height}`
}
