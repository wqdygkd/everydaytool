import type { ExtensionModuleId, ShellHelloOkPayload } from '../../../shared/extension.ts'

export interface ShellConnectionState {
  connected: boolean
  connecting: boolean
  wsPort: number | null
  lastError: string | null
  appId: string
  clientId: string
  version: string
  modules: ExtensionModuleId[]
  lastMessageAt: number
}

export type FeatureBackgroundContext = {
  getState: () => ShellConnectionState
  send: (module: ExtensionModuleId | string, type: string, payload?: unknown, requestId?: string) => boolean
  onEnvelope: (
    module: ExtensionModuleId | string,
    type: string,
    handler: (payload: unknown, requestId?: string) => void,
  ) => () => void
  /**
   * 发请求等回执：payload = 成功；null = 超时；undefined = 未发出。
   * 回执靠信封 requestId 匹配（任意 module/type，只要 requestId 一致）。
   */
  requestFromEdt: (
    module: ExtensionModuleId | string,
    type: string,
    payload?: unknown,
    timeoutMs?: number,
  ) => Promise<unknown>
  ensureConnected: (timeoutMs?: number) => Promise<boolean>
  forceReconnect: (timeoutMs?: number) => Promise<boolean>
  isConnected: () => boolean
  /** 通知 popup 刷新业务态（popup-state-changed） */
  notifyPopup: () => void
}

export type FeaturePopupTab = {
  id: string
  label: string
}

export type FeatureDefinition = {
  id: ExtensionModuleId
  label: string
  /** background 侧注册；仅在 hello-ok.modules 包含本 id 时启用 */
  setupBackground?: (ctx: FeatureBackgroundContext, bootstrap?: unknown) => void | (() => void)
  popupTab?: FeaturePopupTab
}

export type HelloOkHandler = (payload: ShellHelloOkPayload) => void
