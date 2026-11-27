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

/**
 * 唯一的 WXP 默认设置来源（后端 config-store 与渲染层 store/表单共用）。
 * 标成 Required：默认值本来就是完整配置；若沿用 WxpSettings 的可选字段，
 * 渲染层 `reactive({ ...DEFAULT_WXP_SETTINGS })` 会把 cacheLogin / showStatusBadge /
 * extraArgs 推成 `boolean | undefined`，绑到 UiSwitchField / el-input 的必填 v-model 就会报 2322。
 */
export const DEFAULT_WXP_SETTINGS: Required<WxpSettings> = {
  executablePath: '',
  debugPort: 9553,
  cacheLogin: true,
  showStatusBadge: true,
  extraArgs: '',
}

const WXP_EXTRA_ARG_DENYLIST = [
  '--user-data-dir',
  '--load-extension',
  '--disable-web-security',
  '--allow-running-insecure-content',
  '--no-sandbox',
  '--remote-debugging-pipe',
  '--remote-debugging-port',
  '--remote-allow-origins',
  '--proxy-server',
] as const

/** Chromium 启动参数分词；引号内的空格不拆开。 */
export function parseWxpExtraArgs(input: string): string[] {
  const text = input.trim()
  if (!text) return []
  const tokens: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (const match of text.matchAll(re)) {
    tokens.push(match[1] ?? match[2] ?? match[3])
  }
  return tokens
}

/** 只允许常规 Chromium 开关；危险开关由主进程统一补齐。 */
export function assertWxpExtraArgs(input: string): void {
  for (const arg of parseWxpExtraArgs(input)) {
    const name = arg.split('=', 1)[0]?.toLowerCase() ?? ''
    if (WXP_EXTRA_ARG_DENYLIST.includes(name as typeof WXP_EXTRA_ARG_DENYLIST[number])) {
      throw new Error(`启动参数不允许使用 ${name}`)
    }
  }
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

/** 链接中心里的一家医院（来自 Vuex tenants；branchid 是 suit 接口的查询键） */
export interface WxpHospitalOption {
  code: string
  name: string
  branchid: string
}

/**
 * 链接中心的一行转发连接。字段来自 WXP 中间件 `suit/getByUserAndBranch`，
 * `online` 由主进程通道端口集合（`getPortsByTenant`）推断——它才是通道状态的唯一事实来源。
 */
export interface WxpChannelLink {
  id: string
  /** 接口原始名称（含「(转发N)」后缀） */
  name: string
  /** 去掉「(转发N)」后缀的名称，与 WXP 表格列一致 */
  simpleName: string
  /** `[正式]` / `[非正式]` */
  sceneformal: string
  accessPoint: string
  targetPoint: string
  /** 接入点主机：只有 127.0.0.1 / localhost 才能在 WXP 内建立通道 */
  localIp: string
  /** 本地监听端口（= middle_port），通道按它匹配 */
  localPort: number
  relIp: string
  relPort: number
  /** 浏览器类型：yumbrowse / deliverbrowse / middlebrowse（复制地址时决定默认路径） */
  browsetype: string
  /** opera 端口（与 localPort 相等时按 yumbrowse 处理） */
  operaPort: number
  protocol: string
  urlSuffix: string
  canOpen: boolean
  online: boolean
}

/** 通道快照：工具端只读镜像（不落盘、不缓存「启用」状态） */
export interface WxpChannelSnapshot {
  hospitals: WxpHospitalOption[]
  /** 本快照对应的医院；未指定时取 WXP 当前医院 */
  hospitalCode: string
  /** WXP 里当前选中的医院（Vuex currentTenant） */
  currentCode: string
  links: WxpChannelLink[]
  onlinePorts: number[]
  collectedAt: number
  /** 页面侧读取失败的原因（未登录 / 没选医院 / 中间件接口异常） */
  error?: string
}

/** 建立 / 关闭通道的入参（link 只取标识与端口，其余字段不参与操作） */
export interface WxpChannelTogglePayload {
  hospitalCode: string
  link: WxpChannelLink
}

export interface WxpChannelToggleResult {
  /** 端口原本就是目标状态：没有真的发出建立 / 关闭 */
  already: boolean
  /** 操作后的端口集合 */
  ports: number[]
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
