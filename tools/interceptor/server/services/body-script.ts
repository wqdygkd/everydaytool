// 动态请求体脚本：代理侧在 vm 沙箱中执行用户脚本改写请求体。
// 契约对齐 Requestly：用户在规则里编写 `async function modifyRequestBody(args) { ... }`，
// args = { method, url, body, bodyAsJson }，返回新请求体。返回 null 表示执行失败（调用方保留原请求体）。
import vm from 'node:vm'
import { logger } from '../../../../server/utils/logger.ts'

/** 脚本执行超时（同步与 async 均适用） */
export const REQUEST_BODY_SCRIPT_TIMEOUT_MS = 1000

export interface RequestBodyScriptArgs {
  method: string
  url: string
  body: string
}

function parseBodyAsJson(body: string): unknown {
  if (!body) return null
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

function withTimeout<T>(value: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
    value.then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 在沙箱中执行 `modifyRequestBody(args)` 并返回新请求体字符串。
 * 未定义函数 / 抛出异常 / 超时 / 返回空值时返回 null（保留原请求体）。
 */
export async function runRequestBodyScript(code: string, args: RequestBodyScriptArgs): Promise<string | null> {
  const sandbox = {
    args: {
      method: args.method,
      url: args.url,
      body: args.body,
      bodyAsJson: parseBodyAsJson(args.body),
    },
    console: {
      log: (...values: unknown[]) => logger.info(`[interceptor] [body-script] ${values.map(String).join(' ')}`),
      warn: (...values: unknown[]) => logger.warn(`[interceptor] [body-script] ${values.map(String).join(' ')}`),
      error: (...values: unknown[]) => logger.error(`[interceptor] [body-script] ${values.map(String).join(' ')}`),
    },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
  }

  let result: unknown
  try {
    const context = vm.createContext(sandbox)
    const script = new vm.Script(`${code}\n;(typeof modifyRequestBody === 'function' ? modifyRequestBody(args) : undefined)`)
    result = script.runInContext(context, { timeout: REQUEST_BODY_SCRIPT_TIMEOUT_MS })
  } catch (error) {
    logger.warn(`[interceptor] 请求体脚本执行失败：${describeError(error)}`)
    return null
  }

  try {
    result = await withTimeout(Promise.resolve(result), REQUEST_BODY_SCRIPT_TIMEOUT_MS)
  } catch (error) {
    logger.warn(`[interceptor] 请求体脚本执行失败：${describeError(error)}`)
    return null
  }

  if (result === undefined || result === null) return null
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}
