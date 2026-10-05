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

// ---- WXP 增强（CDP 启动 + 登录缓存 + CSS/JS 界面注入） ----

export type WxpEnhancementType = 'css' | 'js'

export type WxpRunningStatus = 'launching' | 'waiting' | 'connecting' | 'running' | 'error' | 'stopped'

export interface WxpSettings {
  executablePath: string
  debugPort: number
  /** 缓存登录状态：镜像应用存于 sessionStorage 的用户信息并在启动时还原，自动进入主页（登出后失效） */
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

export interface WxpEnhancement {
  id: string
  name: string
  type: WxpEnhancementType
  code: string
  enabled: boolean
  /** 非空时仅在 URL 包含该子串的页面生效 */
  urlPattern?: string
}

export interface WxpConfig {
  settings: WxpSettings
  enhancements: WxpEnhancement[]
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

export interface WxpTarget {
  id: string
  title: string
  url: string
  type: string
  parentId: string | null
  devToolsUrl: string
}

export interface WxpOpenDevToolsPayload {
  devToolsUrl?: string
  title?: string
  external?: boolean
  port?: number | null
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

// 自定义标题栏页内菜单的动作（AppMenuBar → preload → 主进程执行）
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
