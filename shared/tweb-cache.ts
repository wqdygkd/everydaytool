// tweb-cache（以 tweb / Telegram Web K 为前端）的共享常量与类型。
//
// 归档实现与 HTTP 协议由本工具自己的后端提供；归档默认落在 `<assets>/tweb-cache/`，
// 也可在工具内单独指定目录。这里只放本工具独有的东西：站点端口、归档目录、配置与站点状态。

/**
 * 站点端口基址：固定 origin，避免登录态（IndexedDB / localStorage / SW 注册）作废。
 * 端口必须确定；被占用时才在 RANGE 内顺延，并把实际端口落盘。
 */
export const TWEB_CACHE_SITE_PORT_BASE = 34200
export const TWEB_CACHE_SITE_PORT_RANGE = 16
export const TWEB_CACHE_SITE_PORT_MIN = 1024
export const TWEB_CACHE_SITE_PORT_MAX = 65535

export interface TwebCacheConfig {
  /** 站点端口：落盘后固定，保 origin 不变；null = 还没分配过 */
  sitePort: number | null
  /**
   * 归档根目录（tweb-cache 自己的 messages/ 与 trash/ 所在目录）：
   * null = 默认 `<assets>/tweb-cache`；非 null 时是用户单独选择的绝对路径。
   */
  archiveDir: string | null
}

export const TWEB_CACHE_DEFAULT_CONFIG: TwebCacheConfig = {
  sitePort: null,
  archiveDir: null,
}

/** 主进程 → 渲染层：归档状态 / 进度推送 */
export const TWEB_ARCHIVE_LIBRARY_EVENT_CHANNEL = 'tweb-cache:event:library'

/** 自托管 tweb 的站点状态：页面与 /api、/media 同源 */
export interface TwebCacheSiteInfo {
  ready: boolean
  /** 形如 http://127.0.0.1:<port>/；未就绪时 null */
  url: string | null
  /** 当前实际端口；未就绪时 null */
  port: number | null
  /** 上次落盘的端口（诊断 origin 是否变化用） */
  previousPort: number | null
  /**
   * 上次落盘端口与实际端口不一致 → origin 已变，页面侧的登录态 / IndexedDB / Cache Storage /
   * Service Worker 注册全部作废（都需要重新登录），UI 必须明确提示。
   */
  originChanged: boolean
  /** origin 变化时给出的说明（写入失败/端口被占用等），否则 null */
  portNote: string | null
  error: string | null
}

/** 归档目录状态：默认位置、当前生效位置与是否被单独自定义 */
export interface TwebCacheArchiveDirInfo {
  /** 当前生效的归档根目录（其下有 messages/ 与 trash/） */
  archiveDir: string
  /** `<assets>/tweb-cache` */
  defaultArchiveDir: string
  isCustom: boolean
}

export interface TwebCacheArchiveDirChangeResult extends TwebCacheArchiveDirInfo {
  changed: boolean
  /** 实际迁移的条目名（messages / trash） */
  moved: string[]
}
