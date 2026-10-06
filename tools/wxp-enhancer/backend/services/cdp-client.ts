import type { WxpTarget } from '../../../../shared/types.js'
import { sleep } from '../../../../shared/sleep.js'

function buildDevToolsUrl(webSocketDebuggerUrl: string, port: number): string {
  const wsPath = webSocketDebuggerUrl.replace(/^wss?:\/\//, '')
  return `http://127.0.0.1:${port}/devtools/inspector.html?ws=${wsPath}`
}

interface CdpTargetRaw {
  id: string
  title?: string
  url?: string
  type: string
  parentId?: string | null
  devtoolsFrontendUrl?: string
  webSocketDebuggerUrl?: string
}

function resolveDevToolsUrl(target: CdpTargetRaw, port: number): string {
  const frontend = target.devtoolsFrontendUrl
  if (frontend?.startsWith('http://') || frontend?.startsWith('https://')) {
    return frontend
  }
  if (frontend?.startsWith('/')) {
    return `http://127.0.0.1:${port}${frontend}`
  }
  return buildDevToolsUrl(target.webSocketDebuggerUrl as string, port)
}

export function isAllowedDevToolsUrl(url: string): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(url)
}

const DEBUGGABLE_TARGET_TYPES = new Set(['page', 'iframe'])

function mapTarget(target: CdpTargetRaw, port: number): WxpTarget {
  return {
    id: target.id,
    title: target.title || '(无标题)',
    url: target.url || '',
    type: target.type,
    parentId: target.parentId ?? null,
    devToolsUrl: resolveDevToolsUrl(target, port),
  }
}

async function fetchTargets(port: number): Promise<CdpTargetRaw[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json`)
  if (!response.ok) {
    throw new Error(`CDP /json 请求失败: ${response.status}`)
  }
  const list = await response.json() as CdpTargetRaw[]
  return list.filter(item => DEBUGGABLE_TARGET_TYPES.has(item.type) && item.webSocketDebuggerUrl)
}

interface CdpMessage {
  id?: number
  error?: { message?: string }
  result?: Record<string, unknown>
}

interface PendingCall { resolve: (value: Record<string, unknown>) => void, reject: (reason: Error) => void }
type CdpCaller = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>

function createCdpCaller(ws: WebSocket): CdpCaller {
  let messageId = 0
  const pending = new Map<number, PendingCall>()

  ws.addEventListener('message', (event) => {
    let message: CdpMessage
    try {
      message = JSON.parse(String(event.data)) as CdpMessage
    } catch {
      return
    }
    if (!message.id) return

    const pendingCall = pending.get(message.id)
    if (!pendingCall) return
    pending.delete(message.id)
    if (message.error) {
      pendingCall.reject(new Error(message.error.message || 'CDP 调用失败'))
      return
    }
    pendingCall.resolve(message.result ?? {})
  })

  const call: CdpCaller = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++messageId
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (!pending.has(id)) return
        pending.delete(id)
        reject(new Error(`CDP 超时: ${method}`))
      }, 15000)
    })

  return call
}

async function connectWebSocket(wsUrl: string): Promise<WebSocket> {
  const ws = new WebSocket(wsUrl)
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error(`WebSocket 连接失败: ${wsUrl}`)), { once: true })
  })
  return ws
}

async function injectTarget(
  wsUrl: string,
  scriptSource: string,
  previousIdentifier: string | null = null,
): Promise<string> {
  const ws = await connectWebSocket(wsUrl)
  const call = createCdpCaller(ws)
  try {
    await call('Page.enable')
    if (previousIdentifier) {
      try {
        await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: previousIdentifier })
      } catch {
        // 旧标识可能已失效，忽略
      }
    }
    const result = await call('Page.addScriptToEvaluateOnNewDocument', { source: scriptSource })
    const identifier = result.identifier as string
    await call('Runtime.evaluate', { expression: scriptSource, returnByValue: true })
    return identifier
  } finally {
    ws.close()
  }
}

export async function listPageTargets(port: number): Promise<WxpTarget[]> {
  const targets = await fetchTargets(port)
  return targets.map(target => mapTarget(target, port))
}

export async function waitForCdpPort(port: number, timeoutMs = 30000): Promise<CdpTargetRaw[]> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const targets = await fetchTargets(port)
      if (targets.length > 0) {
        return targets
      }
    } catch {
      // port not ready
    }
    await sleep(500)
  }
  throw new Error(`CDP 端口 ${port} 在 ${timeoutMs}ms 内无可用页面`)
}

interface TargetInjectionState {
  url: string
  scriptIdentifier: string
}

interface CdpInjectionSessionOptions {
  port: number
  scriptSource: string
  pollIntervalMs?: number
  onTargetsInjected?: (info: { count: number, total: number }) => void
}

export class CdpInjectionSession {
  port: number
  scriptSource: string
  pollIntervalMs: number
  onTargetsInjected?: (info: { count: number, total: number }) => void
  paused = false
  private targetState = new Map<string, TargetInjectionState>()
  private stopped = false
  private pollTimer: NodeJS.Timeout | null = null
  private injecting = false

  constructor({ port, scriptSource, pollIntervalMs = 2000, onTargetsInjected }: CdpInjectionSessionOptions) {
    this.port = port
    this.scriptSource = scriptSource
    this.pollIntervalMs = pollIntervalMs
    this.onTargetsInjected = onTargetsInjected
  }

  get injectedTargetCount(): number {
    return this.targetState.size
  }

  async pause(): Promise<void> {
    this.paused = true
    while (this.injecting) {
      await sleep(50)
    }
  }

  resume(): void {
    this.paused = false
  }

  async start(): Promise<void> {
    await this.scanAndInject()
    this.pollTimer = setInterval(() => {
      this.scanAndInject().catch(() => {})
    }, this.pollIntervalMs)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.targetState.clear()
  }

  private async injectIntoTarget(target: CdpTargetRaw, force = false): Promise<boolean> {
    const prev = this.targetState.get(target.id)
    const url = target.url || ''
    if (!force && prev && prev.url === url) {
      return false
    }

    const scriptIdentifier = await injectTarget(
      target.webSocketDebuggerUrl as string,
      this.scriptSource,
      prev?.scriptIdentifier ?? null,
    )
    this.targetState.set(target.id, { url, scriptIdentifier })
    return true
  }

  setScriptSource(scriptSource: string): void {
    this.scriptSource = scriptSource
  }

  /** 扫描全部可调试页面并注入；force 为 true 时忽略 URL 去重强制重注入 */
  async scanAndInject(force = false): Promise<number> {
    if (this.stopped || this.injecting || (this.paused && !force)) return 0

    this.injecting = true
    try {
      const targets = await fetchTargets(this.port)
      const activeIds = new Set<string>()
      let injectedCount = 0

      for (const target of targets) {
        activeIds.add(target.id)
        if (await this.injectIntoTarget(target, force)) {
          injectedCount += 1
        }
      }

      for (const id of this.targetState.keys()) {
        if (!activeIds.has(id)) {
          this.targetState.delete(id)
        }
      }

      if (injectedCount > 0) {
        this.onTargetsInjected?.({ count: injectedCount, total: targets.length })
      }

      return injectedCount
    } finally {
      this.injecting = false
    }
  }
}
