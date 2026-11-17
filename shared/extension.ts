// everydaytool 浏览器插件（平台层）共享契约：
// 扩展 ID / 控制通道端口 / 信封协议 / shell 消息。
// 纯类型与常量：主进程、扩展、测试共用；不依赖 Electron / DOM。
// 设计定稿见 docs/browser-extension.md。

/** 捆绑扩展的固定 ID：由 manifest.key（公钥）推导；迁移期与历史 interceptor 扩展同源，禁止更换 */
export const EDT_EXTENSION_ID = 'hlinfcmdeamelkpdemppomgncenalong'

/** 控制通道（WS）端口：基准 + 扫描范围（edt 占首个空闲，扩展按同段探测） */
export const EDT_EXTENSION_WS_PORT_BASE = 59763
export const EDT_EXTENSION_WS_PORT_RANGE = 5

/** 信封协议版本；不兼容变更时递增 */
export const EXTENSION_PROTOCOL_VERSION = 1 as const

/** 运行时令牌文件名（由主进程写入扩展 load 目录根） */
export const EXTENSION_BRIDGE_TOKEN_FILE = 'bridge-token.json'

/** 平台 shell + 已登记 feature；新工具在此联合类型追加字面量 */
export type ExtensionModuleId = 'shell' | 'interceptor'

export interface ExtensionEnvelope<T = unknown> {
  v: typeof EXTENSION_PROTOCOL_VERSION
  module: ExtensionModuleId | (string & {})
  type: string
  requestId?: string
  payload?: T
}

export function isExtensionEnvelope(value: unknown): value is ExtensionEnvelope {
  if (!value || typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  return rec.v === EXTENSION_PROTOCOL_VERSION
    && typeof rec.module === 'string'
    && typeof rec.type === 'string'
}

export function makeEnvelope<T>(
  module: ExtensionModuleId | string,
  type: string,
  payload?: T,
  requestId?: string,
): ExtensionEnvelope<T> {
  const envelope: ExtensionEnvelope<T> = {
    v: EXTENSION_PROTOCOL_VERSION,
    module,
    type,
  }
  if (payload !== undefined) envelope.payload = payload
  if (requestId !== undefined) envelope.requestId = requestId
  return envelope
}

// ---------------------------------------------------------------------------
// shell 模块消息（连接 / 能力协商；业务 sync 走各 feature）
// ---------------------------------------------------------------------------

export interface ShellHelloPayload {
  appId: string
  clientId: string
  version: string
  token: string
}

export interface ShellHelloOkPayload {
  wsPort: number
  /** 宿主已启用的模块；扩展据此挂载 feature */
  modules: ExtensionModuleId[]
  /**
   * 各 feature 的启动快照（避免 hello 后再抢一轮 sync 竞态）。
   * interceptor 约定字段：proxyPort / targets / scripts / rules / proxyDesired
   */
  bootstraps?: Partial<Record<ExtensionModuleId, unknown>>
}

export type ShellHelloRejectReason = 'bad-origin' | 'bad-token' | 'busy'

export interface ShellHelloRejectPayload {
  reason: ShellHelloRejectReason
}

export interface ShellHeartbeatPayload {
  at: number
}

export interface ShellPingPayload {
  at: number
}
