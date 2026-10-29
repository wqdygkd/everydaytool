// telegram-tt 站点托管（阶段 0）：把构建产物、缓存 API、本地媒体放在**同一个 loopback origin**。
//
// 为什么必须同源：
// - telegram-tt 的 CSP 是 `default-src 'self'` / `media-src 'self'` / `connect-src 'self' …`；
//   页面、/api、/media 同源时无需改 CSP，`<video>` 与 fetch 都按普通同源资源处理；
// - webview 的 preload 被平台剥离，页面不能走 IPC，只能走同源 HTTP。
//
// 关键点：
// - 只绑 127.0.0.1 + 随机端口 + 一次性 token（写进 /edt-bootstrap.js，页面启动时读取）；
// - 静态路径必须留在 dist 内；媒体只接受索引内的 key（由 resolveMedia 决定）；
// - Range/206/416 用于视频拖动；index.html 与 API 一律 no-store；
// - Service Worker 脚本额外带 `Service-Worker-Allowed: /`（即使当前构建把 SW 放在根目录，也不依赖默认作用域）。
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { logger } from '../../../../backend/utils/logger.ts'
import { parseByteRange } from './http-semantics.ts'

const MAX_JSON_BODY_BYTES = 32 * 1024 * 1024
const BOOTSTRAP_PATH = '/edt-bootstrap.js'
const SERVICE_WORKER_RE = /(?:^|[/\\])service\.worker[^/\\]*\.js$/

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
}

export interface SiteMediaTarget {
  absolutePath: string
  size: number
  mimeType?: string
}

export interface SiteApiContext {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  origin: string
  sendJson: (status: number, payload: unknown) => void
  readJson: <T>() => Promise<T>
  /** 二进制 body（归档分片），上限与 JSON 相同 */
  readBuffer: () => Promise<Buffer>
}

export interface SiteServerOptions {
  /** telegram-tt 的 dist 目录（必须含 index.html） */
  rootDir: string
  /** 不传则每次启动随机生成 */
  token?: string
  /** 诊断用版本号 */
  apiVersion?: string
  /** 媒体解析：只接受索引内的 key；返回 undefined → 404 */
  resolveMedia?: (mediaKey: string) => SiteMediaTarget | undefined | Promise<SiteMediaTarget | undefined>
  /** 缩略图解析（可选） */
  resolveThumb?: (mediaKey: string) => SiteMediaTarget | undefined | Promise<SiteMediaTarget | undefined>
  /** 批量缓存状态（/api/media/status） */
  getMediaStatus?: (keys: string[]) => unknown | Promise<unknown>
  /** 其余 /api/*（归档等）由工具域实现；返回 true 表示已处理 */
  handleApi?: (context: SiteApiContext) => boolean | Promise<boolean>
}

export interface SiteServerInfo {
  url: string
  port: number
  token: string
  rootDir: string
}

interface SseClient {
  res: ServerResponse
  heartbeat: ReturnType<typeof setInterval>
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

function resolveInside(rootDir: string, relativePath: string): string | null {
  const normalizedRoot = path.resolve(rootDir)
  const target = path.resolve(normalizedRoot, relativePath)
  if (target === normalizedRoot) return target
  if (!target.startsWith(`${normalizedRoot}${path.sep}`)) return null
  return target
}

function mimeTypeFor(filePath: string, fallback?: string): string {
  return fallback ?? MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function isServiceWorkerPath(filePath: string): boolean {
  return SERVICE_WORKER_RE.test(filePath)
}

export class TelegramSiteServer {
  private readonly options: SiteServerOptions
  private readonly token: string
  private readonly apiVersion: string
  private readonly sseClients = new Set<SseClient>()
  private server: ReturnType<typeof createServer> | null = null
  private info: SiteServerInfo | null = null
  private indexHtml: string | null = null

  constructor(options: SiteServerOptions) {
    this.options = options
    this.token = options.token ?? randomBytes(32).toString('hex')
    this.apiVersion = options.apiVersion ?? '0'
  }

  async start(): Promise<SiteServerInfo> {
    if (this.info) return this.info
    const indexPath = path.join(this.options.rootDir, 'index.html')
    const rawIndex = await readFile(indexPath, 'utf8')
    this.indexHtml = this.injectBootstrap(rawIndex)

    const server = createServer((req, res) => {
      void this.handleRequest(req, res).catch((error: unknown) => {
        logger.warn('Telegram site server request failed', { error: (error as Error).message })
        if (res.headersSent) {
          res.destroy()
          return
        }
        this.sendJson(res, 500, { error: 'internal error' })
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address() as AddressInfo
    this.server = server
    this.info = {
      url: `http://127.0.0.1:${address.port}/`,
      port: address.port,
      token: this.token,
      rootDir: this.options.rootDir,
    }
    logger.info('Telegram site server listening', { url: this.info.url })
    return this.info
  }

  stop(): void {
    for (const client of this.sseClients) {
      clearInterval(client.heartbeat)
      client.res.destroy()
    }
    this.sseClients.clear()
    if (this.server) {
      this.server.close()
      this.server.closeAllConnections?.()
      this.server = null
    }
    this.info = null
  }

  getInfo(): SiteServerInfo | null {
    return this.info
  }

  /** SSE 广播（进度/状态）；无客户端时是空操作 */
  broadcast(event: string, payload: unknown): void {
    const body = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
    for (const client of this.sseClients) {
      try {
        client.res.write(body)
      } catch {
        this.sseClients.delete(client)
      }
    }
  }

  private injectBootstrap(html: string): string {
    const script = `<script src="${BOOTSTRAP_PATH}"></script>`
    if (!html.includes('</head>')) return `${script}${html}`
    return html.replace('</head>', `${script}\n</head>`)
  }

  private buildBootstrapScript(): string {
    const payload = JSON.stringify({
      token: this.token,
      api: '/api',
      media: '/media',
    })
    return `window.__EDT__ = ${payload};\n`
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const info = this.info
    if (!info) {
      this.sendJson(res, 503, { error: 'site server starting' })
      return
    }
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')

    if (!this.isAllowedHost(req, info) || !this.isAllowedOrigin(req, info)) {
      this.sendJson(res, 403, { error: 'forbidden' })
      return
    }

    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', info.url)
    let pathname: string
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      this.sendJson(res, 400, { error: 'malformed path' })
      return
    }

    if (pathname === BOOTSTRAP_PATH) {
      this.sendText(res, 200, this.buildBootstrapScript(), 'text/javascript; charset=utf-8', 'no-store')
      return
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      if (!this.hasValidToken(req, url)) {
        this.sendJson(res, 401, { error: 'invalid token' })
        return
      }
      await this.handleApiRoute(req, res, url, info)
      return
    }

    if (pathname.startsWith('/media/')) {
      if (!this.hasValidToken(req, url)) {
        this.sendJson(res, 401, { error: 'invalid token' })
        return
      }
      if (method !== 'GET' && method !== 'HEAD') {
        this.sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      const mediaKey = pathname.slice('/media/'.length)
      await this.serveResolved(req, res, mediaKey, this.options.resolveMedia, 'media')
      return
    }

    if (pathname.startsWith('/thumb/')) {
      if (!this.hasValidToken(req, url)) {
        this.sendJson(res, 401, { error: 'invalid token' })
        return
      }
      if (method !== 'GET' && method !== 'HEAD') {
        this.sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      const mediaKey = pathname.slice('/thumb/'.length)
      await this.serveResolved(req, res, mediaKey, this.options.resolveThumb, 'thumb')
      return
    }

    if (pathname === '/events') {
      if (!this.hasValidToken(req, url)) {
        this.sendJson(res, 401, { error: 'invalid token' })
        return
      }
      this.openEventStream(req, res)
      return
    }

    if (method !== 'GET' && method !== 'HEAD') {
      this.sendJson(res, 405, { error: 'method not allowed' })
      return
    }

    this.serveStatic(req, res, pathname)
  }

  private isAllowedHost(req: IncomingMessage, info: SiteServerInfo): boolean {
    const host = (req.headers.host ?? '').toLowerCase()
    return host === `127.0.0.1:${info.port}` || host === `localhost:${info.port}`
  }

  private isAllowedOrigin(req: IncomingMessage, info: SiteServerInfo): boolean {
    const origin = req.headers.origin
    if (!origin) return true
    return origin === `http://127.0.0.1:${info.port}` || origin === `http://localhost:${info.port}`
  }

  private hasValidToken(req: IncomingMessage, url: URL): boolean {
    const header = req.headers['x-edt-token']
    const provided = typeof header === 'string' ? header : url.searchParams.get('t') ?? ''
    return Boolean(provided) && constantTimeEqual(provided, this.token)
  }

  private async handleApiRoute(req: IncomingMessage, res: ServerResponse, url: URL, info: SiteServerInfo): Promise<void> {
    const method = req.method ?? 'GET'
    if (method === 'GET' && url.pathname === '/api/health') {
      this.sendJson(res, 200, {
        ok: true,
        version: this.apiVersion,
        origin: info.url,
        now: Date.now(),
      })
      return
    }

    if (method === 'GET' && url.pathname === '/api/media/status') {
      const keys = (url.searchParams.get('keys') ?? '')
        .split(',')
        .map(key => key.trim())
        .filter(Boolean)
      if (!this.options.getMediaStatus) {
        this.sendJson(res, 501, { error: 'media status is not wired yet' })
        return
      }
      this.sendJson(res, 200, { statuses: await this.options.getMediaStatus(keys) })
      return
    }

    if (this.options.handleApi) {
      const handled = await this.options.handleApi({
        req,
        res,
        url,
        origin: info.url,
        sendJson: (status, payload) => this.sendJson(res, status, payload),
        readJson: <T>() => this.readJsonBody<T>(req),
        readBuffer: () => this.readBody(req),
      })
      if (handled) return
    }

    this.sendJson(res, 404, { error: 'unknown api route' })
  }

  private async serveResolved(
    req: IncomingMessage,
    res: ServerResponse,
    mediaKey: string,
    resolver: SiteServerOptions['resolveMedia'],
    kind: 'media' | 'thumb',
  ): Promise<void> {
    if (!resolver) {
      this.sendJson(res, 404, { error: `${kind} is not available` })
      return
    }
    if (!/^[\w.-]{1,200}$/.test(mediaKey)) {
      this.sendJson(res, 400, { error: 'invalid media key' })
      return
    }
    const target = await resolver(mediaKey)
    if (!target || !existsSync(target.absolutePath)) {
      this.sendJson(res, 404, { error: 'media not found' })
      return
    }
    let size: number
    try {
      const stat = statSync(target.absolutePath)
      if (!stat.isFile()) {
        this.sendJson(res, 404, { error: 'media not found' })
        return
      }
      size = stat.size
    } catch {
      this.sendJson(res, 404, { error: 'media not found' })
      return
    }
    const mimeType = mimeTypeFor(target.absolutePath, target.mimeType)
    this.serveFile(req, res, target.absolutePath, size, mimeType, 'no-store', true)
  }

  private serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    const info = this.info
    if (!info) return
    const relativePath = pathname.replace(/^\/+/, '')
    const target = resolveInside(info.rootDir, relativePath)
    if (!target) {
      this.sendJson(res, 403, { error: 'forbidden path' })
      return
    }

    let filePath = target
    let isIndex = false
    let isFile = false
    try {
      isFile = existsSync(filePath) && statSync(filePath).isFile()
    } catch {
      isFile = false
    }
    if (isFile) {
      isIndex = path.basename(filePath).toLowerCase() === 'index.html'
    } else {
      // SPA 兜底：telegram-tt 用 hash 路由，无扩展名路径一律回 index.html
      if (path.extname(pathname) !== '') {
        this.sendJson(res, 404, { error: 'not found' })
        return
      }
      filePath = path.join(info.rootDir, 'index.html')
      isIndex = true
    }

    if (isIndex) {
      if (!this.indexHtml) {
        this.sendJson(res, 500, { error: 'index.html is missing' })
        return
      }
      const body = Buffer.from(this.indexHtml, 'utf8')
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Content-Length', String(body.length))
      res.setHeader('Cache-Control', 'no-store')
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      res.end(body)
      return
    }

    let fileSize = 0
    try {
      fileSize = statSync(filePath).size
    } catch {
      this.sendJson(res, 404, { error: 'not found' })
      return
    }
    const cacheControl = isServiceWorkerPath(filePath) ? 'no-store' : 'public, max-age=31536000, immutable'
    this.serveFile(req, res, filePath, fileSize, mimeTypeFor(filePath), cacheControl, false)
  }

  private serveFile(
    req: IncomingMessage,
    res: ServerResponse,
    filePath: string,
    size: number,
    mimeType: string,
    cacheControl: string,
    allowRange: boolean,
  ): void {
    const rangeHeader = allowRange ? (req.headers.range ?? undefined) : undefined
    const parsedRange = rangeHeader ? parseByteRange(rangeHeader, size) : null
    if (parsedRange === 'unsatisfiable') {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${size}`)
      res.setHeader('Content-Type', mimeType)
      res.end()
      return
    }

    const isRange = parsedRange !== null
    const start = parsedRange ? parsedRange.start : 0
    const end = parsedRange ? parsedRange.end : size - 1
    const length = Math.max(0, end - start + 1)

    res.statusCode = isRange ? 206 : 200
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Length', String(length))
    res.setHeader('Accept-Ranges', allowRange ? 'bytes' : 'none')
    res.setHeader('Cache-Control', cacheControl)
    if (isRange) res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    if (isServiceWorkerPath(filePath)) res.setHeader('Service-Worker-Allowed', '/')

    if (req.method === 'HEAD' || length === 0) {
      res.end()
      return
    }

    const stream = createReadStream(filePath, { start, end })
    res.on('close', () => stream.destroy())
    stream.on('error', (error) => {
      logger.warn('Telegram site static stream failed', { error: error.message, file: path.basename(filePath) })
      res.destroy()
    })
    stream.pipe(res)
  }

  private openEventStream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
    })
    res.write('retry: 3000\n\n')
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        clearInterval(heartbeat)
      }
    }, 25_000)
    const client: SseClient = { res, heartbeat }
    this.sseClients.add(client)
    req.on('close', () => {
      clearInterval(heartbeat)
      this.sseClients.delete(client)
    })
  }

  private async readBody(req: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      total += buffer.length
      if (total > MAX_JSON_BODY_BYTES) throw new Error('body too large')
      chunks.push(buffer)
    }
    return Buffer.concat(chunks)
  }

  private async readJsonBody<T>(req: IncomingMessage): Promise<T> {
    const body = await this.readBody(req)
    if (body.length === 0) return {} as T
    return JSON.parse(body.toString('utf8')) as T
  }

  private sendJson(res: ServerResponse, status: number, payload: unknown): void {
    if (res.writableEnded) return
    const body = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8')
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Length', String(body.length))
    res.setHeader('Cache-Control', 'no-store')
    res.end(body)
  }

  private sendText(res: ServerResponse, status: number, body: string, contentType: string, cacheControl: string): void {
    const buffer = Buffer.from(body, 'utf8')
    res.statusCode = status
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', String(buffer.length))
    res.setHeader('Cache-Control', cacheControl)
    res.end(buffer)
  }
}

let current: TelegramSiteServer | null = null

export async function startTelegramSiteServer(options: SiteServerOptions): Promise<SiteServerInfo> {
  if (current) return current.getInfo() ?? (await current.start())
  const server = new TelegramSiteServer(options)
  const info = await server.start()
  current = server
  return info
}

export function stopTelegramSiteServer(): void {
  current?.stop()
  current = null
}

export function getTelegramSiteServerInfo(): SiteServerInfo | null {
  return current?.getInfo() ?? null
}

export function broadcastTelegramSiteEvent(event: string, payload: unknown): void {
  current?.broadcast(event, payload)
}
