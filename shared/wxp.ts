// WXP 增强域共享类型与默认设置（renderer ↔ 主进程 backend）。

export type WxpRunningStatus = 'launching' | 'waiting' | 'connecting' | 'running' | 'error' | 'stopped'

export interface WxpSettings {
  executablePath: string
  debugPort: number
  /** 缓存登录状态：整体快照应用存于 sessionStorage 的登录会话并在启动时还原（超期快照不还原），宽限后自动进入主页，并补跑登录后初始化（租户列表 / 代理 NameNode / iframe SSO） */
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

/** 链接收藏。页面与工具缓存同一结构；旧的 `环境|名称|接入点|原地址` 只在读取时拆开。 */
export interface WxpLinkFavorite {
  sceneformal: string
  simpleName: string
  accessPoint: string
  targetPoint: string
  /** 收藏时的医院中文名，只用于展示 */
  hospital: string
  /** 租户 id。医院改名后仍用它对应链接中心的医院 */
  tenantId: string
  /** 租户编码。打开链接时作为主机名前缀 */
  code: string
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
    /** 登录账号（来自 Vuex 用户对象；应用凭据缓存为 RSA 加密，工具不解密） */
    username: string
    /** 登录密码：应用 RSA 加密存储，工具不再采集，恒为空 */
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
  /** 链接收藏。旧缓存里的 `|` 拼接字符串在读取时拆成对象 */
  favorites: WxpLinkFavorite[]
  /** 收藏备份时间戳：页面星标变更时间（WXP 被卸载/清缓存后靠它恢复，不会被旧备份复活已取消的收藏） */
  favoritesUpdatedAt: number
}
