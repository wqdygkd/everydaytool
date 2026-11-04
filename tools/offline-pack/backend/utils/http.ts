// offline-pack 后端：上游 HTTP 请求封装（Node fetch）。
// 统一 UA、超时、错误归一；提供文本 / JSON / Buffer / 流式落盘四种形态。
import { Buffer } from 'node:buffer'
import { createWriteStream } from 'node:fs'
// 用 Electron net.fetch 走 Chromium 网络栈（继承系统代理），Node 原生 fetch 不走系统代理，
// 导致大陆环境挂代理仍无法访问 Docker Hub 等被墙上游。
import { net } from 'electron'
import { logger } from '../../../../backend/utils/logger.ts'
import { OFFLINE_PACK_USER_AGENT } from '../../../../shared/offline-pack.ts'

const DEFAULT_TIMEOUT_MS = 60_000

export interface HttpOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
}

export interface HttpError extends Error {
  status?: number
  isTimeout?: boolean
  /** 非 2xx 时的响应正文（供调用方按上游提示做可读翻译） */
  body?: string
}

function extractErrorCode(error: unknown): string | undefined {
  const cause = (error as { cause?: unknown })?.cause
  if (cause && typeof cause === 'object') {
    const c = cause as { code?: unknown, errors?: unknown[] }
    if (typeof c.code === 'string') return c.code
    // undici 网络失败可能是 AggregateError，错误码在 errors[0].code
    if (Array.isArray(c.errors)) {
      for (const e of c.errors) {
        if (e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string') {
          return (e as { code: string }).code
        }
      }
    }
  }
  return undefined
}

function isTimeoutError(error: unknown): boolean {
  const code = extractErrorCode(error)
  // request() 里超时用 AbortController 触发，undici 抛 ABORT_ERR；
  // 连接建立阶段超时才是 UND_ERR_CONNECT_TIMEOUT
  return code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ABORT_ERR'
}

/** 把上游错误归一成带 status / isTimeout 的 Error，调用方据此给出可读提示 */
export function toHttpError(error: unknown, prefix: string): HttpError {
  const err = error as HttpError
  if (err && typeof err.message === 'string' && (err.status !== undefined || err.isTimeout)) return err
  const timeout = isTimeoutError(error)
  const code = extractErrorCode(error)
  const suffix = code && !timeout ? `（${code}）` : ''
  const message = timeout
    ? `${prefix}超时，请检查网络环境`
    : `${prefix}失败${suffix}，请检查网络环境`
  const wrapped = new Error(message) as HttpError
  wrapped.isTimeout = timeout
  wrapped.cause = error as Error
  return wrapped
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const externalSignal = init.signal
  const onExternalAbort = (): void => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onExternalAbort)
  }
  try {
    return await net.fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
  }
}

function buildHeaders(options: HttpOptions): Record<string, string> {
  return { 'User-Agent': OFFLINE_PACK_USER_AGENT, ...options.headers }
}

function assertOk(res: Response): void {
  if (res.ok) return
  const err = new Error(`上游响应 ${res.status}`) as HttpError
  err.status = res.status
  throw err
}

/** 与 assertOk 一致，但保留响应正文：部分加速服务用 403 + 纯文本说明拒绝原因 */
async function assertOkWithBody(res: Response): Promise<void> {
  if (res.ok) return
  const err = new Error(`上游响应 ${res.status}`) as HttpError
  err.status = res.status
  err.body = await res.text().catch(() => '')
  throw err
}

/** 原始响应（不校验状态码），供 Docker Bearer challenge 读取 401 的 WWW-Authenticate 头 */
export async function fetchRaw(url: string, options: HttpOptions = {}): Promise<Response> {
  return request(url, { headers: buildHeaders(options), signal: options.signal }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
}

export async function fetchText(url: string, options: HttpOptions = {}): Promise<string> {
  const res = await request(url, { headers: buildHeaders(options), signal: options.signal }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  assertOk(res)
  return res.text()
}

export async function fetchJson<T = unknown>(url: string, options: HttpOptions = {}): Promise<T> {
  const res = await request(url, { headers: buildHeaders(options), signal: options.signal }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  await assertOkWithBody(res)
  const text = await res.text()
  const contentType = res.headers.get('content-type') ?? ''
  try {
    return JSON.parse(text) as T
  } catch (error) {
    // 上游可能返回 HTML（网关错误页 / 加速服务首页），只看到 `Unexpected token '<'`
    // 无法定位是哪一个接口；在错误里带上 URL 与响应片段。
    const snippet = text.slice(0, 240).replace(/\s+/g, ' ')
    logger.warn('offline-pack 上游返回非 JSON 内容', { url, status: res.status, contentType, body: text })
    const looksHtml = snippet.startsWith('<')
    const err = new Error(looksHtml
      ? `上游返回 HTML 页面（${res.status}）：${url}。请检查系统代理或切换加速服务`
      : `上游返回非 JSON（${res.status}${contentType ? ` ${contentType}` : ''}）：${url}`) as HttpError
    err.status = res.status
    err.body = text
    err.cause = error as Error
    throw err
  }
}

export async function postJson<T = unknown>(url: string, body: unknown, options: HttpOptions = {}): Promise<T> {
  const res = await request(url, {
    method: 'POST',
    headers: { ...buildHeaders(options), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal,
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  assertOk(res)
  return (await res.json()) as T
}

export async function postForm<T = unknown>(url: string, form: Record<string, string>, options: HttpOptions = {}): Promise<T> {
  const res = await request(url, {
    method: 'POST',
    headers: { ...buildHeaders(options), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    signal: options.signal,
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  assertOk(res)
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

export interface ProgressCallback {
  (downloaded: number, total: number): void
}

/** 下载到内存 Buffer（中小文件；带可选进度回调） */
export async function fetchBuffer(
  url: string,
  options: HttpOptions & { onProgress?: ProgressCallback } = {},
): Promise<Buffer> {
  const res = await request(url, { headers: buildHeaders(options), signal: options.signal }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  assertOk(res)
  const total = Number(res.headers.get('content-length') ?? 0)
  if (!res.body || !options.onProgress) {
    return Buffer.from(await res.arrayBuffer())
  }
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let downloaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
    downloaded += value.length
    options.onProgress(downloaded, total)
  }
  return Buffer.concat(chunks)
}

/** 流式下载到文件（大文件不常驻内存），带背压控制与进度回调 */
export async function downloadToFile(
  url: string,
  destPath: string,
  options: HttpOptions & { onProgress?: ProgressCallback } = {},
): Promise<void> {
  const res = await request(url, { headers: buildHeaders(options), signal: options.signal }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  assertOk(res)
  if (!res.body) throw new Error('上游未返回文件流')
  const total = Number(res.headers.get('content-length') ?? 0)
  const writer = createWriteStream(destPath)
  const reader = res.body.getReader()
  let downloaded = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!writer.write(Buffer.from(value))) {
        await new Promise<void>(resolve => writer.once('drain', () => resolve()))
      }
      downloaded += value.length
      options.onProgress?.(downloaded, total)
    }
  } finally {
    await new Promise<void>(resolve => writer.end(() => resolve()))
  }
}
