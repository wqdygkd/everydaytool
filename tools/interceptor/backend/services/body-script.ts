// 动态请求体脚本：在独立 worker 中执行用户脚本，超时直接终止线程。
// 契约对齐 Requestly：`async function modifyRequestBody(args) { ... }`，
// args = { method, url, body, bodyAsJson }；未返回 / 抛错 / 超时都保留原请求体。
import { Worker } from 'node:worker_threads'
import { logger } from '../../../../backend/utils/logger.ts'

/** 脚本执行超时（含 await 之后的异步阶段；到点直接 terminate worker） */
export const REQUEST_BODY_SCRIPT_TIMEOUT_MS = 1000

export interface RequestBodyScriptArgs {
  method: string
  url: string
  body: string
}

const WORKER_SOURCE = String.raw`
'use strict'
const { parentPort, workerData } = require('node:worker_threads')
const vm = require('node:vm')

const logs = []
function write(level, values) {
  if (logs.length >= 100) return
  logs.push({ level, message: values.map(value => String(value)).join(' ').slice(0, 2000) })
}

function reply(payload) {
  parentPort.postMessage(payload)
}

try {
  const sandbox = {
    args: workerData.args,
    console: {
      log: (...values) => write('info', values),
      warn: (...values) => write('warn', values),
      error: (...values) => write('error', values),
    },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
  }
  const context = vm.createContext(sandbox)
  const script = new vm.Script(workerData.code + "\n;(typeof modifyRequestBody === 'function' ? modifyRequestBody(args) : undefined)")
  const raw = script.runInContext(context, { timeout: workerData.timeoutMs })
  Promise.resolve(raw).then((result) => {
    let value = null
    if (result !== undefined && result !== null) {
      if (typeof result === 'string') value = result
      else {
        try {
          value = JSON.stringify(result)
        } catch {
          value = String(result)
        }
      }
    }
    if (typeof value === 'string' && value.length > 8 * 1024 * 1024) {
      reply({ ok: false, error: '脚本返回内容超过 8 MB', logs })
      return
    }
    reply({ ok: true, value, logs })
  }, (error) => {
    reply({ ok: false, error: error instanceof Error ? error.message : String(error), logs })
  })
} catch (error) {
  reply({ ok: false, error: error instanceof Error ? error.message : String(error), logs })
}
`

interface WorkerReply {
  ok: boolean
  value?: unknown
  error?: string
  logs?: Array<{ level: string, message: string }>
}

function parseBodyAsJson(body: string): unknown {
  if (!body) return null
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function logWorkerMessages(logs: WorkerReply['logs']): void {
  for (const entry of logs ?? []) {
    const message = `[interceptor] [body-script] ${entry.message}`
    if (entry.level === 'warn') logger.warn(message)
    else if (entry.level === 'error') logger.error(message)
    else logger.info(message)
  }
}

/**
 * 在 worker 的 vm 上下文中执行 `modifyRequestBody(args)` 并返回新请求体字符串。
 * 未定义函数 / 抛出异常 / 超时 / 返回空值时返回 null（保留原请求体）。
 */
export function runRequestBodyScript(code: string, args: RequestBodyScriptArgs): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | null = null
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        code,
        args: {
          method: args.method,
          url: args.url,
          body: args.body,
          bodyAsJson: parseBodyAsJson(args.body),
        },
        timeoutMs: REQUEST_BODY_SCRIPT_TIMEOUT_MS,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 16,
      },
    })

    const finish = (value: string | null, error?: string): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (error) logger.warn(`[interceptor] 请求体脚本执行失败：${error}`)
      void worker.terminate().catch(() => undefined)
      resolve(value)
    }

    worker.once('online', () => {
      timer = setTimeout(() => {
        finish(null, `timed out after ${REQUEST_BODY_SCRIPT_TIMEOUT_MS}ms`)
      }, REQUEST_BODY_SCRIPT_TIMEOUT_MS)
      timer.unref?.()
    })
    worker.once('message', (message: WorkerReply) => {
      logWorkerMessages(message.logs)
      if (!message.ok) {
        finish(null, message.error || 'script failed')
        return
      }
      finish(typeof message.value === 'string' ? message.value : null)
    })
    worker.once('error', error => finish(null, describeError(error)))
    worker.once('exit', (exitCode) => {
      if (!settled) finish(null, `worker exited with code ${exitCode}`)
    })
  })
}
