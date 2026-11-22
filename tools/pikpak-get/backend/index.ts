import { disposeLocalEngine } from './engine/adapter.ts'
import { registerPikpakGetHandlers } from './ipc/handlers.ts'

export const pikpakGetBackend = {
  initialize(): void {
    registerPikpakGetHandlers()
  },
  dispose(): void {
    // 本机引擎内嵌在进程里，无需收尾子进程；仅清理门面缓存。
    disposeLocalEngine()
  },
}
