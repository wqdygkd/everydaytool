// 归档存储的「命名空间作用域」：哪个工具正在读写哪份数据。
//
// 背景：telegram-cache 与 tweb-cache 是两个独立工具，归档数据**各存一份**：
//   assets/telegram-cache/messages/…（telegram-tt 前端）
//   assets/tweb-cache/messages/…     （tweb 前端）
// 存储层（message-store / library / trash / media-index）是按工具 id 解析数据分层路径的；
// 同一份代码要服务两个根，就需要一个**进程内的当前作用域**。
//
// 正确性靠「串行」保证：所有入口（HTTP 归档 API、IPC 读写、媒体解析、引擎调用）都通过
// runInArchiveScope(…) 排队执行；作用域只在两个 await 之间被改写，而同一时刻只有一个任务在跑，
// 所以不会出现「A 工具的任务用了 B 工具的路径」。
//
// 约束：本文件属于平台层，不依赖任何工具域代码。
import { AsyncLocalStorage } from 'node:async_hooks'

const DEFAULT_TOOL_ID = 'telegram-cache'

const storage = new AsyncLocalStorage<string>()

/** 当前作用域（没有显式作用域时 = telegram-cache，兼容既有调用） */
export function currentArchiveToolId(): string {
  return storage.getStore() ?? DEFAULT_TOOL_ID
}

/** 同步版本（纯取值，如路径拼接）：只借用作用域，不进串行队列 */
export function runSyncInArchiveScope<T>(toolId: string, fn: () => T): T {
  return storage.run(toolId, fn)
}

let tail: Promise<unknown> = Promise.resolve()

/**
 * 在指定工具命名空间里串行执行 fn。
 * 用 AsyncLocalStorage 而不是裸变量：串行队列里同时只有一段代码在跑，
 * 但嵌套调用（例如 HTTP 处理器里再调引擎）能自然继承作用域。
 */
export function runInArchiveScope<T>(toolId: string, fn: () => Promise<T> | T): Promise<T> {
  const run = () => storage.run(toolId, async () => fn())
  const result = tail.then(run, run) as Promise<T>
  tail = result.catch(() => undefined)
  return result
}
