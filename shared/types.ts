// 跨进程共享类型（renderer ↔ 主进程 backend）
// 仅类型，无运行时逻辑。前端 tsconfig.json 与后端 tsconfig.node.json 均引用。

export type SandboxStatus = 'running' | 'stopped'

export interface LaunchOptions {
  disableSafetyChecks?: boolean
  disableCors?: boolean
  customArgs?: string
}

export interface SandboxMetadata {
  inheritExtensions?: boolean
  launchOptions?: LaunchOptions
  developerModeEnabled?: boolean
}

export interface Sandbox {
  id: string
  name: string
  category: string | null
  color: string | null
  userDataPath: string
  chromePid: number | null
  status: SandboxStatus
  fingerprintId: string | null
  createdAt: string | null
  lastUsedAt: string | null
  lastActiveAt: string | null
  metadata: SandboxMetadata | null
}

export interface SandboxCreatePayload {
  name: string
  fingerprintData?: Fingerprint | null
  inheritExtensions?: boolean
  launchOptions?: LaunchOptions
}

export interface SandboxUpdatePayload {
  name?: string
  category?: string
  color?: string
  chromePid?: number | null
  status?: SandboxStatus
  fingerprintId?: string | null
  lastUsedAt?: string | null
  lastActiveAt?: string | null
  metadata?: SandboxMetadata | null
}

export interface FingerprintNavigator {
  userAgent: string
  platform: string
  language: string
  hardwareConcurrency: number
  deviceMemory: number
}

export interface FingerprintCanvas {
  noiseLevel: 'low' | 'medium' | 'high'
  noiseSeed: number
}

export interface FingerprintWebgl {
  vendor: string
  renderer: string
}

export interface FingerprintScreen {
  width: number
  height: number
  colorDepth: number
  devicePixelRatio: number
}

export interface FingerprintAudio {
  noiseEnabled: boolean
  noiseLevel: number
}

export interface FingerprintTimezone {
  offset: number
  name: string
}

export interface Fingerprint {
  id: string
  navigator: FingerprintNavigator
  canvas: FingerprintCanvas
  webgl: FingerprintWebgl
  screen: FingerprintScreen
  audio: FingerprintAudio
  timezone: FingerprintTimezone
  createdAt?: string | null
  updatedAt?: string | null
}

export type FingerprintCreatePayload = Omit<Fingerprint, 'createdAt' | 'updatedAt'>
export type FingerprintUpdatePayload = Partial<Omit<Fingerprint, 'id'>>

export interface AppConfig {
  chromePath: string
  defaultProfile: string
  dataDirectory: string
  autoRestoreOnStartup: boolean
  preserveDataOnClose: boolean
}

export interface AppConfigUpdate {
  chromePath?: string
  defaultProfile?: string
  dataDirectory?: string
  autoRestoreOnStartup?: boolean
  preserveDataOnClose?: boolean
}

export interface SetupState extends AppConfig {
  dataDirectoryConfigured: boolean
  dataDirectoryChanged?: boolean
}

// ---- WXP 增强（CDP 启动 + 登录缓存 + 内置页面增强） ----

export type WxpRunningStatus = 'launching' | 'waiting' | 'connecting' | 'running' | 'error' | 'stopped'

export interface WxpSettings {
  executablePath: string
  debugPort: number
  /** 缓存登录状态：整体快照应用存于 sessionStorage 的登录会话并在启动时还原（token 过期不还原），宽限后自动进入主页，并补跑登录后初始化（租户列表 / 代理 NameNode / iframe SSO；登出后失效） */
  cacheLogin?: boolean
  /** 在 WXP 窗口左下角显示「增强中」呼吸灯角标 */
  showStatusBadge?: boolean
  extraArgs?: string
}

/** 唯一的 WXP 默认设置来源（后端 config-store 与渲染层 store/表单共用） */
export const DEFAULT_WXP_SETTINGS: WxpSettings = {
  executablePath: '',
  debugPort: 9553,
  cacheLogin: true,
  showStatusBadge: true,
  extraArgs: '',
}

export interface WxpRunningState {
  pid?: number
  port: number
  status: WxpRunningStatus
  message: string
  targetCount?: number
  launchArgs?: string[]
  updatedAt: number
}

export interface WxpClearLoginCacheResult {
  /** 已清除登录缓存的页面数（WXP 未运行、登记待清除时为 0） */
  pages: number
  /** WXP 未运行：仅登记待清除标记，下次启动注入时自动执行 */
  pending?: boolean
}

/** 从 WXP 页面采集并在工具侧缓存的数据（data-cache.json） */
export interface WxpDataCache {
  /** 采集时间戳（ms） */
  collectedAt: number
  login: {
    accessToken: string
    refreshToken: string
    accessExpiresAt: number
    refreshExpiresAt: number
    /** 登录账号（来自应用凭据缓存 login-info-cache） */
    username: string
    password: string
    /** 路由守卫恢复出的用户对象（Vuex getters.user） */
    user: Record<string, unknown> | null
    /** NameNode 地址（登录响应参数镜像） */
    nameNodeAddrs: string
    /** 租户状态查询服务器（登录响应参数镜像） */
    statusQueryServers: string
    /** 会话快照是否存在 */
    snapshotExists: boolean
  }
  /** 链接收藏键列表（环境|名称|接入点|原地址） */
  favorites: string[]
}

// ---- Treease 编辑器接口拦截（多接口，每接口独立规则） ----

export interface TreeaseInterceptPatch {
  path: string
  value: unknown
}

export interface TreeaseInterceptRule {
  id: string
  name: string
  enabled: boolean
  urlPattern: string
  action: 'modify' | 'block'
  patches: TreeaseInterceptPatch[]
}

export interface TreeaseInterceptStatus {
  webContentsId: number
  attached: boolean
  ruleCount: number
  hits: number
}

export interface EnvConfig {
  id: string
  name: string
  url: string
  username: string
  password: string
  remark?: string | null
  autoLogin: number
  createdAt: string | null
  updatedAt: string | null
}

export interface EnvCreatePayload {
  name: string
  url: string
  username: string
  password: string
  remark?: string
  autoLogin?: boolean
}

export interface EnvUpdatePayload {
  name?: string
  url?: string
  username?: string
  password?: string
  remark?: string
  autoLogin?: boolean
}

export interface TreeaseInterceptLog {
  webContentsId: number
  hits: number
}

// ---- 应用壳设置（数据目录 / 磁盘用量 / 缓存清理，经 preload 命名空间 edtApp） ----

export interface AppDataDirectoryInfo {
  dataDirectory: string
  defaultDataDirectory: string
  isCustom: boolean
}

export interface AppDataDirectoryUpdateResult extends AppDataDirectoryInfo {
  changed: boolean
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

// 应用菜单动作（preload `menuAction` → 主进程执行；页内菜单已移除，桥接保留）
export type ShellMenuAction
  = | 'quit'
    | 'undo'
    | 'redo'
    | 'cut'
    | 'copy'
    | 'paste'
    | 'selectAll'
    | 'reload'
    | 'reloadIgnoringCache'
    | 'toggleDevTools'
    | 'zoomIn'
    | 'zoomOut'
    | 'zoomReset'
    | 'minimize'
    | 'close'
