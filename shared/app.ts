// 应用壳设置域共享类型（数据目录 / 磁盘用量 / 缓存清理，经 edtApp 命令命名空间）。

export interface AppDataDirectoryInfo {
  dataDirectory: string
  defaultDataDirectory: string
  isCustom: boolean
  /** 已请求但需重启后迁移生效的目标目录（null 表示没有待切换） */
  pendingDataDirectory: string | null
}

export interface AppDataDirectoryUpdateResult extends AppDataDirectoryInfo {
  /** 本次是否记录了变更（变更一律在下次启动迁移生效，渲染层据此提示重启） */
  changed: boolean
}

/** 首次启动引导状态（应用壳与 chrome-sandbox 工具域共用同一份 setup 标记） */
export interface AppSetupState {
  /** 数据目录是否已确认过：true 则不再弹首次引导 */
  dataDirectoryConfigured: boolean
}

export interface DataRootEntryUsage {
  name: string
  bytes: number
  isDirectory: boolean
}

export interface DataRootUsage {
  totalBytes: number
  cacheBytes: number
  entries: DataRootEntryUsage[]
}

export interface CacheCleanResult {
  freedBytes: number
  cleanedDirs: number
  /** 因路径被跳过（如运行中沙箱）或被占用而未清理的目录数 */
  skippedDirs: number
}
