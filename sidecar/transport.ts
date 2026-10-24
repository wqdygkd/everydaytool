// Node 业务运行时 ↔ Rust 宿主的 stdio JSON-RPC 传输层。
// 协议（每行一个 JSON 对象）：
//   Rust → Node  {"kind":"invoke","id":1,"domain":"edtApp","command":"...","args":[...]}
//   Node → Rust  {"kind":"response","id":7,"ok":true,"result":...} / {"ok":false,"error":"..."}
//   Rust → Node  {"kind":"shutdown"}
//   Node → Rust  {"kind":"ready"} / {"kind":"error","message":"..."}
//   Node → Rust  {"kind":"event","channel":"...","payload":...}
//   Node → Rust  {"kind":"platform","id":7,"op":"dialog.open","args":{...}}
// stdout 只承载协议帧；所有 console 输出改道 stderr，避免污染协议。
import type { PlatformTransport } from '../server/utils/platform.ts'
import process from 'node:process'
import { createInterface } from 'node:readline'

type InvokeHandler = (domain: string, command: string, args: unknown[]) => Promise<unknown>

interface PendingPlatform {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<number, PendingPlatform>()
let nextPlatformId = 1
let invokeHandler: InvokeHandler | null = null
let shutdownHandler: (() => Promise<void>) | null = null
let shuttingDown = false

const PLATFORM_REQUEST_TIMEOUT_MS = 5 * 60 * 1000
const SHUTDOWN_GRACE_MS = 3_000

export function patchConsoleToStderr(): void {
  const levels = ['log', 'info', 'debug', 'warn', 'error'] as const
  for (const level of levels) {
    // eslint-disable-next-line no-console
    console[level] = (...args: unknown[]) => {
      const text = args.map(a => (typeof a === 'string' ? a : safeStringify(a))).join(' ')
      process.stderr.write(`${text}\n`)
    }
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function write(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

export function setInvokeHandler(handler: InvokeHandler): void {
  invokeHandler = handler
}

export function setShutdownHandler(handler: () => Promise<void>): void {
  shutdownHandler = handler
}

export const hostTransport: PlatformTransport = {
  request(op, args) {
    const id = nextPlatformId++
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.delete(id)) {
          reject(new Error(`平台请求超时：${op}`))
        }
      }, PLATFORM_REQUEST_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timer })
      write({ kind: 'platform', id, op, args })
    })
  },
  event(channel, payload) {
    write({ kind: 'event', channel, payload })
  },
}

function rejectPending(error: Error): void {
  for (const request of pending.values()) {
    clearTimeout(request.timer)
    request.reject(error)
  }
  pending.clear()
}

/**
 * Rust 宿主崩溃或被强杀时 stdin 会关闭。不能只依赖 shutdown 帧：
 * 否则 Node sidecar 会带着代理 / 数据库 / 子进程永久驻留。
 */
async function shutdownAndExit(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  rejectPending(new Error('Node 运行时与宿主断开'))
  try {
    const handler = shutdownHandler
    if (handler) {
      await Promise.race([
        handler(),
        new Promise<void>(resolve => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
      ])
    }
  } catch (error) {
    console.error('[host] shutdown failed', (error as Error).message)
  }
  process.exit(0)
}

export function startProtocol(): void {
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity })
  reader.on('line', (line) => {
    const text = line.trim()
    if (!text) return
    let message: Record<string, unknown>
    try {
      message = JSON.parse(text) as Record<string, unknown>
    } catch (error) {
      console.error('[host] invalid protocol frame', (error as Error).message)
      return
    }
    void handleMessage(message)
  })
  reader.on('close', () => {
    void shutdownAndExit()
  })
  process.stdin.on('error', () => {
    void shutdownAndExit()
  })
}

async function handleMessage(message: Record<string, unknown>): Promise<void> {
  const kind = message.kind
  if (kind === 'invoke') {
    const id = message.id
    const domain = String(message.domain ?? '')
    const command = String(message.command ?? '')
    const args = Array.isArray(message.args) ? message.args : []
    try {
      if (!invokeHandler) throw new Error('host invoke handler not ready')
      const result = await invokeHandler(domain, command, args)
      write({ kind: 'response', id, ok: true, result: result ?? null })
    } catch (error) {
      write({ kind: 'response', id, ok: false, error: (error as Error)?.message || String(error) })
    }
    return
  }

  if (kind === 'response') {
    const id = Number(message.id)
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    clearTimeout(request.timer)
    if (message.ok === true) request.resolve(message.result)
    else request.reject(new Error(String(message.error ?? 'platform request failed')))
    return
  }

  if (kind === 'shutdown') {
    await shutdownAndExit()
  }
}

export function markReady(): void {
  write({ kind: 'ready' })
}

export function reportFatal(error: unknown): void {
  write({ kind: 'error', message: (error as Error)?.message || String(error) })
}
