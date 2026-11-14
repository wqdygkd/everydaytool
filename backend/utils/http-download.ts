// 平台级 HTTP 正文下载：取消信号与空闲超时覆盖响应头之后的整个正文阶段。
// 工具后端统一走这里，避免各自在响应头返回后就清掉计时器与取消监听。
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const DEFAULT_IDLE_TIMEOUT_MS = 60_000

export type DownloadFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface HttpDownloadOptions {
  headers?: Record<string, string>
  signal?: AbortSignal
  /** 多久没有收到新数据就失败；不是整次下载的总时长上限。 */
  idleTimeoutMs?: number
  onProgress?: (downloaded: number, total: number) => void
  rejectHtml?: boolean
  /** 期望的 SHA-256（可带 sha256: 前缀），下载过程增量计算并比对 */
  expectedSha256?: string
}

export interface ReadBodyOptions {
  signal?: AbortSignal
  idleTimeoutMs?: number
  onProgress?: (downloaded: number, total: number) => void
}

export class HttpDownloadError extends Error {
  readonly status: number
  readonly url: string

  constructor(url: string, status: number, statusText?: string) {
    super(`下载失败 HTTP ${status}${statusText ? ` ${statusText}` : ''}`)
    this.name = 'HttpDownloadError'
    this.status = status
    this.url = url
  }
}

export class HttpDownloadTimeoutError extends Error {
  readonly isTimeout = true
  readonly code = 'IDLE_TIMEOUT'
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`下载超时：${Math.round(timeoutMs / 1000)} 秒未收到新数据，请检查网络环境`)
    this.name = 'HttpDownloadTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

interface IdleGuard {
  signal: AbortSignal
  arm: () => void
  dispose: () => void
  readonly timedOut: boolean
}

function createIdleGuard(external: AbortSignal | undefined, idleTimeoutMs: number): IdleGuard {
  const controller = new AbortController()
  let timer: NodeJS.Timeout | null = null
  let timedOut = false
  const onExternalAbort = (): void => controller.abort()

  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onExternalAbort)
  }

  const arm = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, idleTimeoutMs)
    timer.unref?.()
  }
  arm()

  return {
    signal: controller.signal,
    arm,
    dispose: () => {
      if (timer) clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    },
    get timedOut() {
      return timedOut
    },
  }
}

function cancelledError(): Error {
  const error = new Error('下载已取消')
  error.name = 'AbortError'
  return error
}

function normalizeBodyError(error: unknown, guard: IdleGuard, external: AbortSignal | undefined, timeoutMs: number): unknown {
  if (guard.timedOut) return new HttpDownloadTimeoutError(timeoutMs)
  if (external?.aborted) return cancelledError()
  return error
}

async function pipeBody(
  body: ReadableStream<Uint8Array>,
  destination: Writable,
  guard: IdleGuard,
  onProgress: ((downloaded: number, total: number) => void) | undefined,
  total: number,
  hash?: ReturnType<typeof createHash>,
): Promise<void> {
  let downloaded = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      guard.arm()
      downloaded += chunk.length
      hash?.update(chunk)
      onProgress?.(downloaded, total)
      callback(null, chunk)
    },
  })

  await pipeline(
    Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>),
    meter,
    destination,
    { signal: guard.signal },
  )
}

function normalizeSha256(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^sha256:/i, '').toLowerCase() ?? ''
  if (!normalized) return undefined
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error('SHA-256 摘要格式非法')
  return normalized
}

async function defaultFetch(url: string, init?: RequestInit): Promise<Response> {
  const { net } = await import('electron')
  return net.fetch(url, init)
}

export async function downloadToFile(
  url: string,
  destPath: string,
  options: HttpDownloadOptions = {},
  fetchImpl: DownloadFetch = defaultFetch,
): Promise<void> {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const guard = createIdleGuard(options.signal, idleTimeoutMs)
  const expected = normalizeSha256(options.expectedSha256)
  const hash = expected ? createHash('sha256') : undefined

  try {
    const res = await fetchImpl(url, { headers: options.headers, signal: guard.signal })
    guard.arm()
    if (!res.ok) throw new HttpDownloadError(url, res.status, res.statusText)
    if (options.rejectHtml && (res.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
      throw new Error('该线路返回的是网页而不是文件，请换一条线路')
    }
    if (!res.body) throw new Error('上游未返回文件流')

    const total = Number(res.headers.get('content-length') ?? 0)
    await pipeBody(res.body, createWriteStream(destPath), guard, options.onProgress, total, hash)
    if (expected && hash?.digest('hex') !== expected) {
      throw new Error('下载内容 SHA-256 校验失败，文件可能被篡改或线路返回了错误内容')
    }
  }
  catch (error) {
    throw normalizeBodyError(error, guard, options.signal, idleTimeoutMs)
  }
  finally {
    guard.dispose()
  }
}

export async function readResponseBody(res: Response, options: ReadBodyOptions = {}): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0)
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const guard = createIdleGuard(options.signal, idleTimeoutMs)
  const chunks: Buffer[] = []
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk)
      callback()
    },
  })
  const total = Number(res.headers.get('content-length') ?? 0)

  try {
    await pipeBody(res.body, sink, guard, options.onProgress, total)
    return Buffer.concat(chunks)
  }
  catch (error) {
    throw normalizeBodyError(error, guard, options.signal, idleTimeoutMs)
  }
  finally {
    guard.dispose()
  }
}
