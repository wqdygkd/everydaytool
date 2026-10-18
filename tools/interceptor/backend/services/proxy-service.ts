// MITM 代理内核（v1）：
// - HTTP：absolute-form 转发；命中处理名单才拆包/改包/记日志，其余透明转发；
// - HTTPS：CONNECT 握手后按名单分流——命中用根 CA 现场签叶证书做 MITM，未命中原始 TCP 隧道（不拆 TLS）；
// - WebSocket/SSE 升级：两侧（明文 / MITM 后）都做透传桥接（v1 不改帧）；
// - 回环目标上游默认跳过证书校验（本地自签名场景）；代理自身端口做自连防护。
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import type { InterceptorRule, InterceptorTarget, ResourceType, TrafficEntry } from '../../../../shared/interceptor.ts'
import type { RuleMatchContext } from './rule-engine.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest, STATUS_CODES } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as netConnect } from 'node:net'
import { createSecureContext, connect as tlsConnect, TLSSocket } from 'node:tls'
import { promisify } from 'node:util'
import * as zlib from 'node:zlib'
import { logger } from '../../../../backend/utils/logger.ts'
import { INTERCEPTOR_PROXY_PORT_BASE, INTERCEPTOR_PROXY_PORT_RANGE, TRAFFIC_BODY_MAX_CHARS } from '../../../../shared/interceptor.ts'
import { runRequestBodyScript } from './body-script.ts'
import { getLeafCertificate } from './cert-service.ts'
import { applyHeaderOperations, applyResponseMutations, findHeaderKey, findMatchingRules, findMockRule, planRequest, setHeaderValue } from './rule-engine.ts'
import { isLoopbackHost, matchTarget, normalizeHost } from './target-list.ts'

const gunzip = promisify(zlib.gunzip)
const inflate = promisify(zlib.inflate)
const brotliDecompress = promisify(zlib.brotliDecompress)

/** 内存缓冲上限：请求/响应体在此范围内完整缓冲（支持改体与完整日志），超出降级为直通 */
const BUFFER_LIMIT_BYTES = 8 * 1024 * 1024
/** 上游请求超时 */
const UPSTREAM_TIMEOUT_MS = 30_000
/** WebSocket 隧道无超时，但握手后空闲保护交给 TCP 自身 */

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

interface MitmSocketInfo {
  host: string
  port: number
}

type EdtSocket = Duplex & { __edtMitm?: MitmSocketInfo }

export interface ProxyServiceDeps {
  getTargets: () => InterceptorTarget[]
  getRules: () => InterceptorRule[]
  onTraffic: (entry: TrafficEntry) => void
  /** 代理 / WS 桥自身端口（回环自连防护） */
  isOwnPort: (port: number) => boolean
}

export interface ProxyService {
  start: () => Promise<number>
  stop: () => Promise<void>
  getPort: () => number | null
  isRunning: () => boolean
}

function parseAuthority(authority: string): { host: string, port: number } | null {
  if (!authority) return null
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end < 0) return null
    const host = authority.slice(1, end)
    const rest = authority.slice(end + 1)
    const port = rest.startsWith(':') ? Number(rest.slice(1)) : 443
    return Number.isFinite(port) ? { host, port } : null
  }
  const colon = authority.lastIndexOf(':')
  if (colon < 0) return { host: authority, port: 443 }
  const port = Number(authority.slice(colon + 1))
  return Number.isFinite(port) ? { host: authority.slice(0, colon), port } : null
}

/** `host[:port]` authority 串（IPv6 带括号；443 省略端口保持 URL 规范形） */
function formatAuthority(host: string, port: number): string {
  const bracketed = host.includes(':') ? `[${host}]` : host
  return port === 443 ? bracketed : `${bracketed}:${port}`
}

function isTextualContentType(contentType: string | undefined): boolean {
  if (!contentType) return false
  return /json|text|xml|javascript|html|css|x-www-form-urlencoded|graphql/i.test(contentType)
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value[0] : value
}

/** 资源类型推断：优先 Sec-Fetch-Dest（现代 Chrome 全量发送），回退 Accept 启发 */
function inferResourceType(headers: IncomingHttpHeaders): ResourceType {
  const dest = headerValue(headers['sec-fetch-dest'])
  if (dest) {
    switch (dest) {
      case 'document':
        return 'main_frame'
      case 'iframe':
      case 'frame':
        return 'sub_frame'
      case 'script':
        return 'script'
      case 'style':
        return 'stylesheet'
      case 'image':
        return 'image'
      case 'font':
        return 'font'
      case 'video':
      case 'audio':
      case 'track':
        return 'media'
      case 'empty':
        return 'xmlhttprequest'
      default:
        return 'other'
    }
  }
  const accept = (headerValue(headers.accept) ?? '').toLowerCase()
  if (accept.includes('text/html')) return 'main_frame'
  if (accept.includes('text/css')) return 'stylesheet'
  if (accept.includes('image/')) return 'image'
  if (accept.includes('javascript')) return 'script'
  if (accept.includes('json')) return 'xmlhttprequest'
  return 'other'
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    // set-cookie 多值用 \n 合并，回写时再拆回数组
    flat[key] = Array.isArray(value) ? value.join('\n') : value
  }
  return flat
}

function toWriteHeaders(flat: Record<string, string>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(flat)) {
    out[key] = value.includes('\n') ? value.split('\n') : value
  }
  return out
}

function stripHopByHop(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) out[key] = value
  }
  return out
}

/** writeHead：有自定义状态文案时用三参形式，否则标准形式 */
function writeHeadWithStatus(res: ServerResponse, statusCode: number, statusText: string | undefined, headers: Record<string, string>): void {
  if (statusText) res.writeHead(statusCode, statusText, toWriteHeaders(headers))
  else res.writeHead(statusCode, toWriteHeaders(headers))
}

async function decodeBody(buffer: Buffer, encoding: string | undefined): Promise<Buffer | null> {
  if (!encoding || encoding === 'identity') return buffer
  try {
    if (encoding === 'gzip') return await gunzip(buffer)
    if (encoding === 'deflate') return await inflate(buffer)
    if (encoding === 'br') return await brotliDecompress(buffer)
  } catch {
    return null
  }
  return null
}

interface CollectedBody {
  buffer: Buffer
  truncated: boolean
  size: number
}

function collectStream(stream: IncomingMessage, limit: number): Promise<CollectedBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let truncated = false
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= limit) chunks.push(chunk)
      else truncated = true
    })
    stream.on('end', () => resolve({ buffer: Buffer.concat(chunks), truncated, size }))
    stream.on('error', error => reject(error))
  })
}

function truncateForLog(body: Buffer | null, truncated: boolean, contentType: string | undefined): { text?: string, truncated: boolean } {
  if (!body?.length) return { truncated }
  if (!isTextualContentType(contentType)) return { truncated }
  const text = body.toString('utf8')
  if (text.length <= TRAFFIC_BODY_MAX_CHARS) return { text, truncated }
  return { text: text.slice(0, TRAFFIC_BODY_MAX_CHARS), truncated: true }
}

export function createProxyService(deps: ProxyServiceDeps): ProxyService {
  let server: Server | null = null
  let port: number | null = null
  const clientSockets = new Set<Socket>()

  function trackSocket(socket: Socket): void {
    clientSockets.add(socket)
    socket.on('close', () => clientSockets.delete(socket))
  }

  function isOwnConnection(host: string, portToCheck: number): boolean {
    return isLoopbackHost(host) && deps.isOwnPort(portToCheck)
  }

  function emitTraffic(entry: TrafficEntry): void {
    try {
      deps.onTraffic(entry)
    } catch (error) {
      logger.warn('Traffic emit failed', { error: (error as Error).message })
    }
  }

  function sendPlainError(res: ServerResponse, statusCode: number, message: string): void {
    res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(message)
  }

  // -------------------------------------------------------------------------
  // 明文 HTTP
  // -------------------------------------------------------------------------

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const mitm = (req.socket as EdtSocket).__edtMitm
    const startedAt = Date.now()

    let scheme: 'http' | 'https'
    let host: string
    let targetPort: number
    let pathAndQuery: string
    let fullUrl: string

    if (mitm) {
      scheme = 'https'
      host = mitm.host
      targetPort = mitm.port
      pathAndQuery = req.url ?? '/'
      // URL 必须带上真实端口：非 443 时省略端口会让 plan.url.port 为空、下游回退连 443
      fullUrl = `https://${formatAuthority(host, targetPort)}${pathAndQuery}`
    } else {
      let parsed: URL
      try {
        parsed = new URL(req.url ?? '')
      } catch {
        sendPlainError(res, 400, 'Bad Request (edt interceptor)')
        return
      }
      scheme = parsed.protocol === 'https:' ? 'https' : 'http'
      host = parsed.hostname
      targetPort = parsed.port ? Number(parsed.port) : scheme === 'https' ? 443 : 80
      pathAndQuery = `${parsed.pathname}${parsed.search}`
      fullUrl = parsed.toString()
    }

    if (isOwnConnection(host, targetPort)) {
      sendPlainError(res, 403, 'Forbidden: edt interceptor self-connection')
      return
    }

    const matchedTarget = matchTarget(deps.getTargets(), host, targetPort)
    if (!matchedTarget) {
      // 非名单：透明转发（不改包、不记日志）
      forwardTransparent(req, res, scheme, host, targetPort, pathAndQuery)
      return
    }

    const path = pathAndQuery.split('?')[0] ?? '/'
    const requestContentType = headerValue(req.headers['content-type'])

    // 请求体：任一启用规则需要体（payload 过滤器 / 改体）时先整体缓冲，否则边转发边采样
    const allRules = deps.getRules()
    const requiresBody = allRules.some(rule => rule.enabled && (rule.type === 'request' || rule.filters?.requestPayload))

    let requestBody: Buffer | null = null
    let requestBodyBuffered = false

    if (requiresBody) {
      const collected = await collectStream(req, BUFFER_LIMIT_BYTES)
      if (collected.truncated) {
        // 超出缓冲上限无法安全匹配/改体：按原样报错更诚实（流已被消费）
        sendPlainError(res, 502, 'Request body too large to modify (edt interceptor)')
        emitTraffic(buildEntry({
          startedAt,
          method: req.method ?? 'GET',
          url: fullUrl,
          scheme,
          host,
          path,
          status: 502,
          error: 'request body exceeds buffer limit for rule processing',
        }))
        return
      }
      requestBody = collected.buffer
      requestBodyBuffered = true
    }

    const ctx: RuleMatchContext = {
      method: req.method ?? 'GET',
      url: fullUrl,
      host: normalizeHost(host),
      path,
      resourceType: inferResourceType(req.headers),
      pageUrl: headerValue(req.headers.referer) ?? headerValue(req.headers.origin),
      requestBody,
      requestContentType,
    }
    const matchedRules = findMatchingRules(allRules, ctx)
    const matchedRuleIds = matchedRules.map(rule => rule.id)
    const matchedRuleNames = matchedRules.map(rule => rule.name)
    const plan = planRequest(matchedRules, new URL(fullUrl))

    try {
      if (plan.cancel) {
        // 取消：直接断开连接，浏览器侧表现为请求失败
        res.destroy()
        emitTraffic(buildEntry({
          startedAt,
          method: ctx.method,
          url: fullUrl,
          scheme,
          host,
          path,
          canceled: true,
          error: 'canceled by rule',
          matchedRuleIds,
          matchedRuleNames,
        }))
        return
      }

      if (plan.delayMs > 0) await sleep(plan.delayMs)

      if (plan.redirectedTo) {
        res.writeHead(plan.redirectStatusCode, {
          'location': plan.redirectedTo,
          'content-type': 'text/plain; charset=utf-8',
          'content-length': '0',
        })
        res.end()
        emitTraffic(buildEntry({
          startedAt,
          method: ctx.method,
          url: fullUrl,
          scheme,
          host,
          path,
          status: plan.redirectStatusCode,
          statusText: STATUS_CODES[plan.redirectStatusCode],
          redirectedTo: plan.redirectedTo,
          delayedByMs: plan.delayMs || undefined,
          matchedRuleIds,
          matchedRuleNames,
        }))
        return
      }

      // URL 改写（replace / queryParam）后的最终上游目标
      const finalScheme: 'http' | 'https' = plan.url.protocol === 'https:' ? 'https' : 'http'
      const finalHost = plan.url.hostname
      const finalPort = plan.url.port ? Number(plan.url.port) : finalScheme === 'https' ? 443 : 80
      const finalPathAndQuery = `${plan.url.pathname}${plan.url.search}`
      const rewrittenTo = plan.rewritten ? plan.url.toString() : undefined

      const headersForUpstream = stripHopByHop(flattenHeaders(req.headers))
      applyHeaderOperations(headersForUpstream, plan.requestHeaders)
      if (plan.userAgent) setHeaderValue(headersForUpstream, 'user-agent', plan.userAgent)
      // 主机被改写：同步 Host 头（含端口时用改写后的 authority）
      if (rewrittenTo && (finalHost !== host || finalPort !== targetPort)) {
        setHeaderValue(headersForUpstream, 'host', plan.url.host)
      }

      let outgoingBody = requestBody
      if (plan.bodyReplace !== undefined) {
        outgoingBody = Buffer.from(plan.bodyReplace, 'utf8')
      } else if (plan.bodyScript !== undefined) {
        // 动态请求体：代理侧沙箱执行用户脚本；执行失败 / 超时 / 未返回时保留原体
        const originalBodyText = requestBody ? requestBody.toString('utf8') : ''
        const nextBody = await runRequestBodyScript(plan.bodyScript, { method: ctx.method, url: fullUrl, body: originalBodyText })
        if (nextBody !== null) {
          outgoingBody = nextBody === '' && requestBody === null ? null : Buffer.from(nextBody, 'utf8')
        }
      }
      if (outgoingBody !== requestBody) {
        const lengthKey = findHeaderKey(headersForUpstream, 'content-length')
        if (lengthKey) headersForUpstream[lengthKey] = outgoingBody ? String(outgoingBody.byteLength) : '0'
      }

      const mockRule = findMockRule(matchedRules)
      if (mockRule) {
        respondWithMock(res, matchedRules, mockRule, ctx, matchedRuleIds, matchedRuleNames, headersForUpstream, outgoingBody, startedAt, plan.delayMs)
        return
      }

      await forwardToUpstream(req, res, {
        scheme: finalScheme,
        host: finalHost,
        port: finalPort,
        pathAndQuery: finalPathAndQuery,
        ctx,
        headers: headersForUpstream,
        body: outgoingBody,
        bodyBuffered: requestBodyBuffered,
        requestContentType,
        matchedRules,
        matchedRuleIds,
        matchedRuleNames,
        startedAt,
        delayedByMs: plan.delayMs || undefined,
        rewrittenTo,
      })
    } catch (error) {
      logger.warn('Proxy request failed', { url: fullUrl, error: (error as Error).message })
      if (!res.headersSent) sendPlainError(res, 502, `Bad Gateway: ${(error as Error).message}`)
      else res.destroy()
      emitTraffic(buildEntry({
        startedAt,
        method: ctx.method,
        url: fullUrl,
        scheme,
        host,
        path,
        error: (error as Error).message,
        matchedRuleIds,
        matchedRuleNames,
      }))
    }
  }

  interface ForwardOptions {
    scheme: 'http' | 'https'
    host: string
    port: number
    pathAndQuery: string
    ctx: RuleMatchContext
    headers: Record<string, string>
    body: Buffer | null
    /** 请求体是否已完整缓冲（true 时 body 为最终发送内容） */
    bodyBuffered: boolean
    requestContentType: string | undefined
    matchedRules: InterceptorRule[]
    matchedRuleIds: string[]
    matchedRuleNames: string[]
    startedAt: number
    delayedByMs?: number
    rewrittenTo?: string
  }

  function forwardTransparent(
    req: IncomingMessage,
    res: ServerResponse,
    scheme: 'http' | 'https',
    host: string,
    targetPort: number,
    pathAndQuery: string,
  ): void {
    const headers = stripHopByHop(flattenHeaders(req.headers))
    const upstreamReq = createUpstreamRequest(scheme, host, targetPort, req.method ?? 'GET', pathAndQuery, headers)
    upstreamReq.on('error', (error) => {
      if (!res.headersSent) sendPlainError(res, 502, `Bad Gateway: ${error.message}`)
      else res.destroy()
    })
    req.pipe(upstreamReq)
    upstreamReq.on('response', (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, toWriteHeaders(flattenHeaders(upstreamRes.headers)))
      upstreamRes.pipe(res)
    })
  }

  function createUpstreamRequest(
    scheme: 'http' | 'https',
    host: string,
    targetPort: number,
    method: string,
    pathAndQuery: string,
    headers: Record<string, string>,
  ) {
    const common = { host, port: targetPort, method, path: pathAndQuery || '/', headers }
    if (scheme === 'https') {
      const isIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')
      return httpsRequest({
        ...common,
        // 回环目标默认跳过上游证书校验（本地自签名场景）；其余默认严格校验
        rejectUnauthorized: !isLoopbackHost(host),
        ...(isIp ? {} : { servername: host }),
      })
    }
    return httpRequest(common)
  }

  async function forwardToUpstream(req: IncomingMessage, res: ServerResponse, options: ForwardOptions): Promise<void> {
    const {
      scheme,
      host,
      port: targetPort,
      pathAndQuery,
      ctx,
      headers,
      body,
      bodyBuffered,
      requestContentType,
      matchedRules,
      matchedRuleIds,
      matchedRuleNames,
      startedAt,
      delayedByMs,
      rewrittenTo,
    } = options

    const upstreamReq = createUpstreamRequest(scheme, host, targetPort, ctx.method, pathAndQuery, headers)
    upstreamReq.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      upstreamReq.destroy(new Error(`upstream timeout (${UPSTREAM_TIMEOUT_MS}ms)`))
    })

    let requestBodyForLog: Buffer | null = body
    let requestBodyTruncated = false

    if (!bodyBuffered) {
      // 不缓冲：边透传边采样日志（仅文本类型且在上限内）
      const chunks: Buffer[] = []
      let size = 0
      let truncated = false
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size <= BUFFER_LIMIT_BYTES && isTextualContentType(requestContentType)) chunks.push(chunk)
        else if (size > BUFFER_LIMIT_BYTES) truncated = true
      })
      req.pipe(upstreamReq)
      req.on('end', () => {
        if (isTextualContentType(requestContentType) && !truncated) requestBodyForLog = Buffer.concat(chunks)
        requestBodyTruncated = truncated
      })
    } else {
      upstreamReq.end(body ?? undefined)
    }

    const upstreamRes = await new Promise<IncomingMessage>((resolve, reject) => {
      upstreamReq.on('response', resolve)
      upstreamReq.on('error', reject)
    })

    const responseContentType = upstreamRes.headers['content-type']
    const responseContentEncoding = upstreamRes.headers['content-encoding']
    const statusCode = upstreamRes.statusCode ?? 502
    const flatResponseHeaders = flattenHeaders(upstreamRes.headers)
    const wantsBodyReplace = matchedRules.some(rule => rule.type === 'response' && rule.response?.bodyReplace !== undefined)

    let loggedBody: Buffer | null = null
    let loggedTruncated = false
    const mocked = false

    if (wantsBodyReplace) {
      const collected = await collectStream(upstreamRes, BUFFER_LIMIT_BYTES)
      if (!collected.truncated) {
        const decoded = await decodeBody(collected.buffer, responseContentEncoding)
        if (decoded) {
          const mutated = applyResponseMutations(matchedRules, statusCode, flatResponseHeaders, decoded)
          const finalStatus = mutated.statusCode
          writeHeadWithStatus(res, finalStatus, mutated.statusText, mutated.headers)
          res.end(mutated.body ?? undefined)
          loggedBody = mutated.body
          finishEntry(finalStatus, mutated.statusText)
          return
        }
        // 解码失败（异常编码）：按原始内容回写，不改体；状态码 / 响应头变更照常应用
        const passthrough = applyResponseMutations(matchedRules, statusCode, flatResponseHeaders, null)
        writeHeadWithStatus(res, passthrough.statusCode, passthrough.statusText, passthrough.headers)
        res.end(collected.buffer)
        loggedBody = collected.buffer
        loggedTruncated = true
        finishEntry(passthrough.statusCode, passthrough.statusText)
        return
      }
      // 超出缓冲上限：放弃改体，直通（已读部分顺序写出）
      const withoutBodyReplace = matchedRules.map(rule =>
        rule.type === 'response' && rule.response
          ? { ...rule, response: { ...rule.response, bodyReplace: undefined } }
          : rule)
      const mutatedHeaders = applyResponseMutations(withoutBodyReplace, statusCode, flatResponseHeaders, null)
      writeHeadWithStatus(res, mutatedHeaders.statusCode, mutatedHeaders.statusText, mutatedHeaders.headers)
      res.write(collected.buffer)
      upstreamRes.pipe(res)
      loggedTruncated = true
      upstreamRes.on('end', () => finishEntry(mutatedHeaders.statusCode, mutatedHeaders.statusText))
      return
    }

    // 流式转发 + 采样日志
    const mutated = applyResponseMutations(matchedRules, statusCode, flatResponseHeaders, null)
    writeHeadWithStatus(res, mutated.statusCode, mutated.statusText, mutated.headers)

    const chunks: Buffer[] = []
    let size = 0
    let truncated = false
    const textual = isTextualContentType(responseContentType)

    upstreamRes.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= BUFFER_LIMIT_BYTES && textual) chunks.push(chunk)
      else if (size > BUFFER_LIMIT_BYTES) truncated = true
    })
    upstreamRes.pipe(res)

    await new Promise<void>((resolve) => {
      res.on('close', resolve)
      res.on('finish', resolve)
    })

    if (textual && !truncated) {
      loggedBody = await decodeBody(Buffer.concat(chunks), responseContentEncoding)
      loggedTruncated = loggedBody === null
    } else {
      loggedTruncated = true
    }
    finishEntry(mutated.statusCode, mutated.statusText)

    function finishEntry(finalStatus: number, customStatusText?: string): void {
      const requestLog = truncateForLog(requestBodyForLog, requestBodyTruncated, requestContentType)
      const responseLog = truncateForLog(loggedBody, loggedTruncated, responseContentType)
      emitTraffic(buildEntry({
        startedAt,
        method: ctx.method,
        url: ctx.url,
        scheme,
        host,
        path: ctx.path,
        status: finalStatus,
        statusText: customStatusText ?? STATUS_CODES[finalStatus],
        durationMs: Date.now() - startedAt,
        requestHeaders: headers,
        requestBody: requestLog.text,
        responseHeaders: mutated.headers,
        responseBody: responseLog.text,
        bodyTruncated: responseLog.truncated,
        mocked,
        delayedByMs,
        rewrittenTo,
        matchedRuleIds,
        matchedRuleNames,
      }))
    }
  }

  function respondWithMock(
    res: ServerResponse,
    matchedRules: InterceptorRule[],
    mockRule: InterceptorRule,
    ctx: RuleMatchContext,
    matchedRuleIds: string[],
    matchedRuleNames: string[],
    requestHeaders: Record<string, string>,
    requestBody: Buffer | null,
    startedAt: number,
    delayMs: number,
  ): void {
    const config = mockRule.response ?? {}
    const statusCode = config.statusCode ?? 200
    const body = config.bodyReplace !== undefined ? Buffer.from(config.bodyReplace, 'utf8') : null
    const headers: Record<string, string> = {
      'content-type': body && /^\s*[[{]/.test(body.toString('utf8')) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'content-length': String(body?.byteLength ?? 0),
    }
    const mutated = applyResponseMutations(matchedRules, statusCode, headers, body)
    writeHeadWithStatus(res, mutated.statusCode, mutated.statusText, mutated.headers)
    res.end(mutated.body ?? undefined)

    const requestLog = truncateForLog(requestBody, false, requestHeaders['content-type'])
    emitTraffic(buildEntry({
      startedAt,
      method: ctx.method,
      url: ctx.url,
      scheme: ctx.url.startsWith('https') ? 'https' : 'http',
      host: ctx.host,
      path: ctx.path,
      status: mutated.statusCode,
      statusText: mutated.statusText ?? STATUS_CODES[mutated.statusCode],
      durationMs: Date.now() - startedAt,
      requestHeaders,
      requestBody: requestLog.text,
      responseHeaders: mutated.headers,
      responseBody: mutated.body?.toString('utf8'),
      mocked: true,
      delayedByMs: delayMs || undefined,
      matchedRuleIds,
      matchedRuleNames,
    }))
  }

  interface BuildEntryInput {
    startedAt: number
    method: string
    url: string
    scheme: 'http' | 'https'
    host: string
    path: string
    status?: number
    statusText?: string
    durationMs?: number
    requestHeaders?: Record<string, string>
    requestBody?: string
    responseHeaders?: Record<string, string>
    responseBody?: string
    bodyTruncated?: boolean
    mocked?: boolean
    canceled?: boolean
    redirectedTo?: string
    delayedByMs?: number
    rewrittenTo?: string
    matchedRuleIds?: string[]
    matchedRuleNames?: string[]
    error?: string
  }

  function buildEntry(input: BuildEntryInput): TrafficEntry {
    return {
      id: randomUUID(),
      at: input.startedAt,
      method: input.method,
      url: input.url,
      scheme: input.scheme,
      host: input.host,
      path: input.path,
      status: input.status,
      statusText: input.statusText,
      durationMs: input.durationMs ?? Date.now() - input.startedAt,
      requestHeaders: input.requestHeaders,
      requestBody: input.requestBody,
      responseHeaders: input.responseHeaders,
      responseBody: input.responseBody,
      bodyTruncated: input.bodyTruncated,
      mocked: input.mocked,
      canceled: input.canceled,
      redirectedTo: input.redirectedTo,
      delayedByMs: input.delayedByMs,
      rewrittenTo: input.rewrittenTo,
      matchedRuleIds: input.matchedRuleIds,
      matchedRuleNames: input.matchedRuleNames,
      error: input.error,
    }
  }

  // -------------------------------------------------------------------------
  // CONNECT（HTTPS 分流：名单内 MITM / 名单外透传隧道）
  // -------------------------------------------------------------------------

  function handleConnect(req: IncomingMessage, clientSocket: Socket, head: Buffer): void {
    const authority = parseAuthority(req.url ?? '')
    if (!authority) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
      return
    }
    const { host, port: targetPort } = authority

    if (isOwnConnection(host, targetPort)) {
      clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }

    const matched = matchTarget(deps.getTargets(), host, targetPort)
    if (!matched) {
      rawTunnel(clientSocket, head, host, targetPort)
      return
    }

    void startMitm(clientSocket, host, targetPort)
  }

  async function startMitm(clientSocket: Socket, host: string, targetPort: number): Promise<void> {
    let leaf
    try {
      leaf = await getLeafCertificate(host)
    } catch (error) {
      logger.warn('Leaf certificate generation failed', { host, error: (error as Error).message })
      clientSocket.destroy()
      return
    }
    if (clientSocket.destroyed) return

    clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: edt-interceptor\r\n\r\n')

    const secureContext = createSecureContext({ key: leaf.keyPem, cert: leaf.certPem })
    const tlsSocket = new TLSSocket(clientSocket, { isServer: true, secureContext })
    ;(tlsSocket as EdtSocket).__edtMitm = { host, port: targetPort }
    tlsSocket.on('error', (error) => {
      logger.debug('MITM TLS socket error', { host, error: error.message })
      tlsSocket.destroy()
    })
    // 交给同一个 http 解析器（TLS 层之上重新按明文 HTTP 处理）
    server?.emit('connection', tlsSocket)
  }

  function rawTunnel(clientSocket: Socket, head: Buffer, host: string, targetPort: number): void {
    const upstream = netConnect({ host, port: targetPort }, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: edt-interceptor\r\n\r\n')
      if (head?.length) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    const destroyBoth = () => {
      upstream.destroy()
      clientSocket.destroy()
    }
    upstream.on('error', destroyBoth)
    clientSocket.on('error', destroyBoth)
    clientSocket.on('close', () => upstream.destroy())
  }

  // -------------------------------------------------------------------------
  // Upgrade（WebSocket / SSE 透传桥接；v1 不改帧，只记录命中目标的握手）
  // -------------------------------------------------------------------------

  function handleUpgrade(req: IncomingMessage, clientSocket: Duplex, head: Buffer): void {
    const mitm = (req.socket as EdtSocket).__edtMitm
    const startedAt = Date.now()

    let scheme: 'http' | 'https'
    let host: string
    let targetPort: number
    let pathAndQuery: string
    let fullUrl: string

    if (mitm) {
      scheme = 'https'
      host = mitm.host
      targetPort = mitm.port
      pathAndQuery = req.url ?? '/'
      fullUrl = `https://${formatAuthority(host, targetPort)}${pathAndQuery}`
    } else {
      let parsed: URL
      try {
        parsed = new URL(req.url ?? '')
      } catch {
        clientSocket.destroy()
        return
      }
      scheme = 'http'
      host = parsed.hostname
      targetPort = parsed.port ? Number(parsed.port) : 80
      pathAndQuery = `${parsed.pathname}${parsed.search}`
      fullUrl = parsed.toString()
    }

    if (isOwnConnection(host, targetPort)) {
      clientSocket.destroy()
      return
    }

    const matched = matchTarget(deps.getTargets(), host, targetPort)

    const isIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')
    const upstream = scheme === 'https'
      ? tlsConnect({
          host,
          port: targetPort,
          rejectUnauthorized: !isLoopbackHost(host),
          ...(isIp ? {} : { servername: host }),
        })
      : netConnect({ host, port: targetPort })

    upstream.on('connect', () => {
      let raw = `${req.method ?? 'GET'} ${pathAndQuery} HTTP/1.1\r\n`
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
      }
      raw += '\r\n'
      upstream.write(raw)
      if (head?.length) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })

    if (matched) {
      // 记录握手响应状态（首个上游分片解析状态行后原样透传）
      let firstChunk = true
      upstream.on('data', (chunk: Buffer) => {
        if (!firstChunk) return
        firstChunk = false
        const statusLine = chunk.toString('latin1').split('\r\n')[0] ?? ''
        const statusMatch = /^HTTP\/1\.\d (\d{3})/.exec(statusLine)
        const status = statusMatch ? Number(statusMatch[1]) : undefined
        const path = pathAndQuery.split('?')[0] ?? '/'
        emitTraffic(buildEntry({
          startedAt,
          method: req.method ?? 'GET',
          url: fullUrl,
          scheme,
          host: normalizeHost(host),
          path,
          status,
          statusText: status ? STATUS_CODES[status] : 'Upgrade',
          durationMs: Date.now() - startedAt,
          matchedRuleIds: [],
          matchedRuleNames: [],
        }))
        // 附加记录在日志中标记为升级隧道
      })
    }

    const destroyBoth = () => {
      upstream.destroy()
      clientSocket.destroy()
    }
    upstream.on('error', destroyBoth)
    clientSocket.on('error', destroyBoth)
    clientSocket.on('close', () => upstream.destroy())
  }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  function listenOnFreePort(basePort: number, range: number): Promise<number> {
    return new Promise((resolve, reject) => {
      let attempt = 0

      const tryListen = (candidate: number): void => {
        const srv = createServer((req, res) => {
          void handleRequest(req, res)
        })
        srv.on('connect', handleConnect)
        srv.on('upgrade', (req, socket, head) => handleUpgrade(req, socket as Duplex, head))
        srv.on('connection', socket => trackSocket(socket))
        srv.on('clientError', (_error, socket) => socket.destroy())
        srv.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE' && attempt < range - 1) {
            attempt++
            tryListen(candidate + 1)
            return
          }
          reject(error)
        })
        srv.listen(candidate, '127.0.0.1', () => {
          server = srv
          port = candidate
          logger.info('Proxy listening', { port: candidate })
          resolve(candidate)
        })
      }

      tryListen(basePort)
    })
  }

  return {
    async start(): Promise<number> {
      if (server && port) return port
      // 端口段与 WS 桥（59763+）不重叠；实际使用端口经 WS 下发给扩展
      return listenOnFreePort(INTERCEPTOR_PROXY_PORT_BASE, INTERCEPTOR_PROXY_PORT_RANGE)
    },

    async stop(): Promise<void> {
      const srv = server
      server = null
      port = null
      for (const socket of clientSockets) socket.destroy()
      clientSockets.clear()
      if (srv) {
        await new Promise<void>(resolve => srv.close(() => resolve()))
      }
    },

    getPort: () => port,
    isRunning: () => server !== null,
  }
}
