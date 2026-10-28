// 应用壳设置域共享类型（数据目录 / 分层用量 / 缓存清理，经 preload 命名空间 edtApp）。
// 分层的归属与策略见 shared/data-layers.ts，设计见 docs/data-layers.md。
import type { DataLayer } from './data-layers.ts'

export interface AppDataDirectoryInfo {
  dataDirectory: string
  defaultDataDirectory: string
  isCustom: boolean
  /** 已请求但需重启后迁移生效的目标目录 */
  pendingDataDirectory: string | null
}

export interface AppDataDirectoryUpdateResult extends AppDataDirectoryInfo {
  /** 本次是否记录了变更（变更一律在下次启动迁移生效，渲染层据此提示重启） */
  changed: boolean
}

/** 层内条目用量（设置页展开明细用；只列体积 > 0 的条目） */
export interface DataLayerEntryUsage {
  id: string
  label: string
  bytes: number
}

export interface DataLayerUsageInfo {
  layer: DataLayer
  label: string
  /** 一行为什么这一层是这一层（来自 DATA_LAYER_META，直接展示） */
  summary: string
  bytes: number
  /** 该层里可再生、可被「清理缓存」释放的部分（配置层 / 资产层恒为 0） */
  cleanableBytes: number
  cleanable: boolean
  entries: DataLayerEntryUsage[]
}

export interface DataUsage {
  dataDirectory: string
  /** 资产层的独立根（默认 `<data>/assets`） */
  assetsRoot: string
  totalBytes: number
  cleanableBytes: number
  layers: DataLayerUsageInfo[]
}

/** 应用壳 UI 偏好（配置层 app/ui-preferences.json）：收藏的工具 + 首页工具顺序 */
export interface UiPreferences {
  favoriteToolIds: string[]
  /**
   * 首页工具的自定义顺序（工具 id 数组，拖拽卡片产生）。
   * 空数组 = 未自定义：首页按工具创建时间倒序（最新在前）。
   */
  toolOrder: string[]
}

/** 资产根信息（独立根，默认 `<data>/assets`，可改到任意盘） */
export interface AppAssetsDirectoryInfo {
  assetsRoot: string
  defaultAssetsRoot: string
  isCustom: boolean
  /** 已请求但需重启后迁移生效的目标目录 */
  pendingAssetsRoot: string | null
}

export interface AppAssetsDirectoryUpdateResult extends AppAssetsDirectoryInfo {
  changed: boolean
}

export interface CacheCleanResult {
  freedBytes: number
  cleanedDirs: number
  /** 因路径被跳过（如运行中沙箱）或被占用而未清理的目录数 */
  skippedDirs: number
}
