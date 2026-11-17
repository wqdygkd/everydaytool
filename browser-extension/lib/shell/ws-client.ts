import {
  EDT_EXTENSION_WS_PORT_BASE,
  EDT_EXTENSION_WS_PORT_RANGE,
  EXTENSION_BRIDGE_TOKEN_FILE,
  EXTENSION_PROTOCOL_VERSION,
  isExtensionEnvelope,
  makeEnvelope,
  type ExtensionEnvelope,
  type ExtensionModuleId,
  type ShellHelloOkPayload,
  type ShellHelloPayload,
  type ShellHelloRejectPayload,
} from '../../../shared/extension.ts'
import type { FeatureBackgroundContext, FeatureDefinition, ShellConnectionState } from './types.ts'

const RECONNECT_ALARM = 'edt-extension-reconnect'
const CONNECT_TIMEOUT_MS = 1200
const HELLO_TIMEOUT_MS = 3000
const STALE_CONNECTION_MS = 60_000

type EnvelopeHandler = (payload: unknown, requestId?: string) => void
type PendingResolver = (payload: unknown) => void

function detectAppId(): string {
  const ua = globalThis.navigator?.userAgent || ''
  if (/Edg\//.test(ua)) return 'existing-edge'
  if (/OPR\//.test(ua)) return 'existing-opera'
  if (/Brave/.test(ua)) return 'existing-brave'
  return 'existing-chrome'
}

export class ExtensionShell {
  private readonly features: FeatureDefinition[]
  private readonly handlers = new Map<string, Set<EnvelopeHandler>>()
  private readonly pendingRequests = new Map<string, PendingResolver>()
  private readonly featureCleanups: Array<() => void> = []
  private socket: WebSocket | null = null
  private connecting: Promise<void> | null = null
  private state: ShellConnectionState = {
    connected: false,
    connecting: false,
    wsPort: null,
    lastError: null,
    appId: detectAppId(),
    clientId: '',
    version: chrome.runtime.getManifest().version,
    modules: [],
    lastMessageAt: 0,
  }

  constructor(features: FeatureDefinition[]) {
    this.features = features
  }

  getState(): ShellConnectionState {
    return { ...this.state }
  }

  isConnected(): boolean {
    return Boolean(this.state.connected && this.socket && this.socket.readyState === WebSocket.OPEN)
  }

  start(): void {
    void this.ensureClientId().then(() => {
      this.wireAlarms()
      void this.connect()
    })
  }

  async reconnect(): Promise<void> {
    this.disconnectSocket()
    await this.connect()
  }

  async ensureConnected(timeoutMs = 1500): Promise<boolean> {
    if (this.isConnected()) {
      if (this.state.lastMessageAt && Date.now() - this.state.lastMessageAt > STALE_CONNECTION_MS) {
        this.disconnectSocket('连接超时，正在重连')
      }
      else {
        return true
      }
    }
    else if (this.state.connected) {
      this.state.connected = false
      this.socket = null
    }

    if (!this.connecting) void this.connect()
    await Promise.race([
      (this.connecting || Promise.resolve()).then(() => undefined).catch(() => undefined),
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
    ])
    return this.isConnected()
  }

  async forceReconnect(timeoutMs = 1500): Promise<boolean> {
    this.disconnectSocket()
    return this.ensureConnected(timeoutMs)
  }

  send(module: ExtensionModuleId | string, type: string, payload?: unknown, requestId?: string): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(makeEnvelope(module, type, payload, requestId)))
    return true
  }

  onEnvelope(module: ExtensionModuleId | string, type: string, handler: EnvelopeHandler): () => void {
    const key = `${module}:${type}`
    let set = this.handlers.get(key)
    if (!set) {
      set = new Set()
      this.handlers.set(key, set)
    }
    set.add(handler)
    return () => {
      set?.delete(handler)
    }
  }

  /**
   * 发请求等回执：成功 → payload；超时 → null；未发出 → undefined。
   */
  requestFromEdt(
    module: ExtensionModuleId | string,
    type: string,
    payload?: unknown,
    timeoutMs = 1500,
  ): Promise<unknown> {
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID()
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        resolve(null)
      }, timeoutMs)
      this.pendingRequests.set(requestId, (result) => {
        clearTimeout(timer)
        resolve(result)
      })
      if (!this.send(module, type, payload, requestId)) {
        clearTimeout(timer)
        this.pendingRequests.delete(requestId)
        resolve(undefined)
      }
    })
  }

  notifyPopup(): void {
    chrome.runtime.sendMessage({ type: 'popup-state-changed' }).catch(() => {})
  }

  private createFeatureContext(): FeatureBackgroundContext {
    return {
      getState: () => this.getState(),
      send: (module, type, payload, requestId) => this.send(module, type, payload, requestId),
      onEnvelope: (module, type, handler) => this.onEnvelope(module, type, handler),
      requestFromEdt: (module, type, payload, timeoutMs) => this.requestFromEdt(module, type, payload, timeoutMs),
      ensureConnected: timeoutMs => this.ensureConnected(timeoutMs),
      forceReconnect: timeoutMs => this.forceReconnect(timeoutMs),
      isConnected: () => this.isConnected(),
      notifyPopup: () => this.notifyPopup(),
    }
  }

  private activateFeatures(
    modules: ExtensionModuleId[],
    bootstraps?: Partial<Record<ExtensionModuleId, unknown>>,
  ): void {
    this.teardownFeatures()
    const enabled = new Set(modules)
    const ctx = this.createFeatureContext()
    for (const feature of this.features) {
      if (!enabled.has(feature.id)) continue
      const cleanup = feature.setupBackground?.(ctx, bootstraps?.[feature.id])
      if (cleanup) this.featureCleanups.push(cleanup)
    }
  }

  private teardownFeatures(): void {
    while (this.featureCleanups.length > 0) {
      const cleanup = this.featureCleanups.pop()
      try {
        cleanup?.()
      }
      catch {
        // ignore feature teardown errors
      }
    }
  }

  private async ensureClientId(): Promise<void> {
    const data = await chrome.storage.local.get({ clientId: '' })
    if (!data.clientId) {
      data.clientId = crypto.randomUUID()
      await chrome.storage.local.set({ clientId: data.clientId })
    }
    this.state.clientId = data.clientId
  }

  private wireAlarms(): void {
    chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 })
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name !== RECONNECT_ALARM) return
      if (this.isConnected()) {
        if (Date.now() - this.state.lastMessageAt > STALE_CONNECTION_MS) {
          this.disconnectSocket('连接超时，正在重连')
          void this.connect()
        }
        return
      }
      void this.connect()
    })
    chrome.runtime.onStartup.addListener(() => {
      void this.connect()
    })
    chrome.runtime.onInstalled.addListener(() => {
      void this.connect()
    })
  }

  private async connect(): Promise<void> {
    if (this.connecting) return this.connecting
    this.state.connecting = true
    this.state.lastError = null
    this.broadcastPopup()

    this.connecting = (async () => {
      const stored = await chrome.storage.local.get({ lastWsPort: 0 })
      const startPort = typeof stored.lastWsPort === 'number' && stored.lastWsPort >= EDT_EXTENSION_WS_PORT_BASE
        ? stored.lastWsPort
        : EDT_EXTENSION_WS_PORT_BASE

      for (let offset = 0; offset < EDT_EXTENSION_WS_PORT_RANGE; offset++) {
        const port = EDT_EXTENSION_WS_PORT_BASE
          + ((startPort - EDT_EXTENSION_WS_PORT_BASE + offset) % EDT_EXTENSION_WS_PORT_RANGE)
        try {
          await this.tryPort(port)
          return
        }
        catch (error) {
          this.state.lastError = error instanceof Error ? error.message : String(error)
        }
      }
      this.state.connected = false
      this.state.connecting = false
      if (!this.state.lastError) this.state.lastError = '未检测到 edt'
      this.broadcastPopup()
    })().finally(() => {
      this.connecting = null
    })

    return this.connecting
  }

  private tryPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`)
      let settled = false

      const fail = (message: string) => {
        if (settled) return
        settled = true
        socket.close()
        reject(new Error(message))
      }

      const connectTimer = setTimeout(() => fail('连接超时'), CONNECT_TIMEOUT_MS)

      socket.addEventListener('open', () => {
        clearTimeout(connectTimer)
        void this.handshake(socket, port).then(() => {
          if (settled) return
          settled = true
          resolve()
        }).catch((error: unknown) => {
          fail(error instanceof Error ? error.message : String(error))
        })
      })

      socket.addEventListener('error', () => fail('无法连接'))
      socket.addEventListener('close', () => {
        if (!settled) fail('连接关闭')
      })
    })
  }

  private async handshake(socket: WebSocket, port: number): Promise<void> {
    const token = await this.readBridgeToken()
    const hello: ShellHelloPayload = {
      appId: this.state.appId,
      clientId: this.state.clientId,
      version: this.state.version,
      token,
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('握手超时')), HELLO_TIMEOUT_MS)

      const onMessage = (event: MessageEvent) => {
        let data: unknown
        try {
          data = JSON.parse(String(event.data))
        }
        catch {
          return
        }
        if (!isExtensionEnvelope(data) || data.module !== 'shell') return

        if (data.type === 'hello-ok') {
          clearTimeout(timer)
          socket.removeEventListener('message', onMessage)
          const payload = (data.payload ?? {}) as ShellHelloOkPayload
          this.attachSocket(socket, port, payload)
          resolve()
          return
        }

        if (data.type === 'hello-reject') {
          clearTimeout(timer)
          socket.removeEventListener('message', onMessage)
          const payload = (data.payload ?? {}) as ShellHelloRejectPayload
          reject(new Error(`握手被拒绝：${payload.reason ?? 'unknown'}`))
        }
      }

      socket.addEventListener('message', onMessage)
      socket.send(JSON.stringify(makeEnvelope('shell', 'hello', hello)))
    })
  }

  private attachSocket(socket: WebSocket, port: number, helloOk: ShellHelloOkPayload): void {
    this.disconnectSocket()
    this.socket = socket
    this.state.connected = true
    this.state.connecting = false
    this.state.wsPort = helloOk.wsPort || port
    this.state.modules = Array.isArray(helloOk.modules) ? helloOk.modules : []
    this.state.lastError = null
    this.state.lastMessageAt = Date.now()
    void chrome.storage.local.set({ lastWsPort: this.state.wsPort })

    socket.addEventListener('message', (event) => {
      this.state.lastMessageAt = Date.now()
      this.dispatchIncoming(String(event.data))
    })
    socket.addEventListener('close', () => {
      this.onSocketClosed()
    })

    this.activateFeatures(this.state.modules, helloOk.bootstraps)
    this.broadcastPopup()
  }

  private dispatchIncoming(raw: string): void {
    let data: unknown
    try {
      data = JSON.parse(raw)
    }
    catch {
      return
    }

    if (!isExtensionEnvelope(data)) return
    const envelope = data as ExtensionEnvelope
    if (envelope.v !== EXTENSION_PROTOCOL_VERSION) return

    if (envelope.module === 'shell' && envelope.type === 'heartbeat') {
      this.send('shell', 'ping', { at: Date.now() })
      return
    }

    if (envelope.requestId) {
      const pending = this.pendingRequests.get(envelope.requestId)
      if (pending) {
        this.pendingRequests.delete(envelope.requestId)
        pending(envelope.payload)
      }
    }

    const key = `${envelope.module}:${envelope.type}`
    const set = this.handlers.get(key)
    if (!set || set.size === 0) return
    for (const handler of set) {
      try {
        handler(envelope.payload, envelope.requestId)
      }
      catch {
        // ignore handler errors
      }
    }
  }

  private onSocketClosed(): void {
    const wasConnected = this.state.connected
    this.socket = null
    this.state.connected = false
    this.state.connecting = false
    if (wasConnected && !this.state.lastError) {
      this.state.lastError = '与 edt 的连接已断开'
    }
    this.teardownFeatures()
    this.broadcastPopup()
    setTimeout(() => {
      void this.connect()
    }, 2000)
  }

  private disconnectSocket(error?: string): void {
    if (error) this.state.lastError = error
    if (this.socket) {
      try {
        this.socket.close()
      }
      catch {
        // ignore
      }
    }
    this.socket = null
    this.state.connected = false
  }

  /** 与旧扩展一致：缺文件 / 无效时回空串，让 hello-reject 路径表达原因 */
  private async readBridgeToken(): Promise<string> {
    try {
      const response = await fetch(chrome.runtime.getURL(EXTENSION_BRIDGE_TOKEN_FILE), { cache: 'no-store' })
      if (!response.ok) return ''
      const json = await response.json() as { token?: string }
      return typeof json.token === 'string' ? json.token : ''
    }
    catch {
      return ''
    }
  }

  private broadcastPopup(): void {
    chrome.runtime.sendMessage({ type: 'shell-state-changed', state: this.getState() }).catch(() => {})
  }
}
