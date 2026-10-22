// 控制通道（WS 服务端）：扩展 MV3 service worker 连入，承载
// 握手（Origin 校验，无配对码）、心跳保活、名单 / 规则 / 脚本下发、代理端口下发、代理状态回传。
// 协议与端口策略见 docs/interceptor.md §7。
import type { IncomingMessage } from 'node:http'
import type {
  EdtToExtensionMessage,
  ExtensionConnectionInfo,
  ExtensionToEdtMessage,
  InjectedScript,
  InterceptorRuleSummary,
  InterceptorTarget,
} from '../../../../shared/interceptor.ts'
import { WebSocket, WebSocketServer } from 'ws'
import { logger } from '../../../../backend/utils/logger.ts'
import { INTERCEPTOR_EXTENSION_ID } from '../../../../shared/interceptor.ts'

/** 扩展必须在连接后该毫秒数内完成 hello 握手，否则断开（防空连占位） */
const HELLO_TIMEOUT_MS = 5_000
/** 心跳间隔：Chrome 116+ 的 WS 流量会重置 SW 空闲计时，同时起保活与掉线检测作用 */
const HEARTBEAT_INTERVAL_MS = 20_000
/** 超过该时长无任何消息视为掉线（心跳 3 次未应答） */
const CONNECTION_STALE_MS = 65_000

export interface WsBridgeDeps {
  getTargets: () => InterceptorTarget[]
  getScripts: () => InjectedScript[]
  /** 规则摘要（弹窗展示 + 开关，匹配逻辑留 edt） */
  getRuleSummaries: () => InterceptorRuleSummary[]
  /** 代理实际监听端口（经 hello-ok 下发给扩展，扩展不硬编码端口） */
  getProxyPort: () => number | null
  suggestHosts: (url: string) => string[]
  onAddTarget: (url: string) => void
  onToggleTarget: (id: string, enabled: boolean) => void
  onRemoveTargetById: (id: string) => void
  onToggleRule: (id: string, enabled: boolean) => void
  onRemoveRule: (id: string) => void
  getSiteInfo: (url: string) => { targets: InterceptorTarget[], related: InterceptorTarget[], rules: InterceptorRuleSummary[], total: number }
  onConnectionsChanged: () => void
  onProxyStateReported: (clientId: string, enabled: boolean, error: string | undefined) => void
  onScriptLog: (clientId: string, scriptId: string, level: string, message: string) => void
}

interface Connection {
  clientId: string
  appId: string
  version: string
  connectedAt: number
  proxyEnabled: boolean
  proxyError?: string
  socket: WebSocket
  lastSeenAt: number
  authed: boolean
  helloTimeout: NodeJS.Timeout | null
}

export interface WsBridge {
  start: (basePort: number, range: number) => Promise<number>
  stop: () => Promise<void>
  getPort: () => number | null
  getConnections: () => ExtensionConnectionInfo[]
  getActiveClientIds: () => string[]
  broadcast: (message: EdtToExtensionMessage) => void
  sendTo: (clientId: string, message: EdtToExtensionMessage) => void
}

const ALLOWED_ORIGIN = `chrome-extension://${INTERCEPTOR_EXTENSION_ID}`

export function createWsBridge(deps: WsBridgeDeps): WsBridge {
  let wss: WebSocketServer | null = null
  let port: number | null = null
  let heartbeatTimer: NodeJS.Timeout | null = null
  const connections = new Map<string, Connection>()

  function send(socket: WebSocket, message: EdtToExtensionMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return
    try {
      socket.send(JSON.stringify(message))
    } catch (error) {
      logger.warn('WS send failed', { error: (error as Error).message })
    }
  }

  function handleMessage(connection: Connection, raw: string): void {
    connection.lastSeenAt = Date.now()

    let message: ExtensionToEdtMessage
    try {
      message = JSON.parse(raw) as ExtensionToEdtMessage
    } catch {
      return
    }
    if (!message || typeof message.type !== 'string') return
    if (!connection.authed && message.type !== 'hello') return

    switch (message.type) {
      case 'hello': {
        if (connection.authed) return
        // 无配对码：来源已在 verifyClient 校验（浏览器无法伪造 Origin），握手即建立会话
        if (connection.helloTimeout) {
          clearTimeout(connection.helloTimeout)
          connection.helloTimeout = null
        }
        connection.authed = true
        connection.clientId = message.clientId || 'unknown'
        connection.appId = message.appId || 'chrome'
        connection.version = message.version || ''
        // 重连（同 clientId 旧连接未清理）：接管为最新连接
        const previous = connections.get(connection.clientId)
        if (previous && previous !== connection) {
          previous.socket.terminate()
          connections.delete(connection.clientId)
        }
        connections.set(connection.clientId, connection)
        send(connection.socket, {
          type: 'hello-ok',
          wsPort: port ?? 0,
          proxyPort: deps.getProxyPort() ?? 0,
          targets: deps.getTargets(),
          scripts: deps.getScripts(),
          rules: deps.getRuleSummaries(),
          proxyDesired: null,
        })
        deps.onConnectionsChanged()
        return
      }
      case 'ping':
        return
      case 'proxy-state': {
        connection.proxyEnabled = message.enabled
        connection.proxyError = message.error
        deps.onProxyStateReported(connection.clientId, message.enabled, message.error)
        deps.onConnectionsChanged()
        return
      }
      case 'add-target':
        deps.onAddTarget(message.url)
        return
      case 'target-toggle':
        deps.onToggleTarget(message.id, message.enabled)
        return
      case 'target-remove-id':
        deps.onRemoveTargetById(message.id)
        return
      case 'rule-toggle':
        deps.onToggleRule(message.id, message.enabled)
        return
      case 'rule-remove':
        deps.onRemoveRule(message.id)
        return
      case 'site-info': {
        const info = deps.getSiteInfo(message.url)
        send(connection.socket, { type: 'site-info-result', requestId: message.requestId, ...info })
        return
      }
      case 'target-suggest': {
        const hosts = deps.suggestHosts(message.url)
        send(connection.socket, { type: 'target-suggest-result', requestId: message.requestId, hosts })
        return
      }
      case 'script-log':
        deps.onScriptLog(connection.clientId, message.scriptId, message.level, message.message)
    }
  }

  function handleConnection(socket: WebSocket, req: IncomingMessage): void {
    const connection: Connection = {
      clientId: '',
      appId: '',
      version: '',
      connectedAt: Date.now(),
      proxyEnabled: false,
      socket,
      lastSeenAt: Date.now(),
      authed: false,
      helloTimeout: null,
    }

    connection.helloTimeout = setTimeout(() => {
      if (!connection.authed) socket.close(4001, 'hello-timeout')
    }, HELLO_TIMEOUT_MS)

    socket.on('message', (data) => {
      handleMessage(connection, data.toString())
    })
    socket.on('close', () => {
      if (connection.helloTimeout) clearTimeout(connection.helloTimeout)
      if (connection.clientId && connections.get(connection.clientId) === connection) {
        connections.delete(connection.clientId)
      }
      deps.onConnectionsChanged()
    })
    socket.on('error', (error) => {
      logger.debug('WS connection error', { origin: req.headers.origin, error: error.message })
    })
  }

  function startHeartbeat(): void {
    if (heartbeatTimer) return
    heartbeatTimer = setInterval(() => {
      const now = Date.now()
      for (const connection of connections.values()) {
        if (now - connection.lastSeenAt > CONNECTION_STALE_MS) {
          connection.socket.terminate()
          continue
        }
        send(connection.socket, { type: 'heartbeat', at: now })
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  function listenOnFreePort(basePort: number, range: number): Promise<number> {
    return new Promise((resolve, reject) => {
      let attempt = 0

      const tryListen = (candidate: number): void => {
        const server = new WebSocketServer({
          host: '127.0.0.1',
          port: candidate,
          // 只接受本扩展来源（浏览器无法伪造 Origin；服务只绑回环，不对外网暴露）
          verifyClient: (info: { origin: string, secure: boolean, req: IncomingMessage }) => {
            const origin = info.origin || info.req.headers.origin
            if (origin === ALLOWED_ORIGIN) return true
            // 非本扩展来源：常见于把「控制端口」误当「代理端口」填进第三方插件
            logger.warn('WS bridge rejected non-extension origin', { origin: origin ?? '(none)' })
            return false
          },
        })

        server.on('connection', handleConnection)
        server.on('listening', () => {
          wss = server
          port = candidate
          startHeartbeat()
          logger.info('WS bridge listening', { port: candidate })
          resolve(candidate)
        })
        server.on('error', (error: NodeJS.ErrnoException) => {
          server.close()
          if (error.code === 'EADDRINUSE' && attempt < range - 1) {
            attempt++
            tryListen(candidate + 1)
            return
          }
          reject(error)
        })
      }

      tryListen(basePort)
    })
  }

  return {
    async start(basePort: number, range: number): Promise<number> {
      if (wss && port) return port
      return listenOnFreePort(basePort, range)
    },

    async stop(): Promise<void> {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
      for (const connection of connections.values()) connection.socket.terminate()
      connections.clear()
      const server = wss
      wss = null
      port = null
      if (server) {
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
    },

    getPort: () => port,

    getConnections(): ExtensionConnectionInfo[] {
      return [...connections.values()].map(connection => ({
        appId: connection.appId,
        clientId: connection.clientId,
        version: connection.version,
        connectedAt: connection.connectedAt,
        proxyEnabled: connection.proxyEnabled,
        proxyError: connection.proxyError,
      }))
    },

    getActiveClientIds(): string[] {
      return [...connections.keys()]
    },

    broadcast(message: EdtToExtensionMessage): void {
      for (const connection of connections.values()) {
        if (connection.authed) send(connection.socket, message)
      }
    },

    sendTo(clientId: string, message: EdtToExtensionMessage): void {
      const connection = connections.get(clientId)
      if (connection?.authed) send(connection.socket, message)
    },
  }
}
