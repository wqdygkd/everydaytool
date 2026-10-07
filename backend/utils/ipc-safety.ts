// 平台级 IPC 安全封装：统一校验调用方来源，避免渲染层（含被注入脚本、远程页面）
// 借用 preload 句柄越权调用主进程能力。工具域注册 handler 时用 safeHandle 替代 ipcMain.handle。
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { isTrustedIpcSenderUrl } from '../../shared/ipc-sender.ts'
import { logger } from './logger.ts'

export type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown

/** 调用方来源不允许时抛出的错误（渲染层侧统一提示，不暴露内部细节） */
export function createIpcForbiddenError(): Error {
  return new Error('IPC 调用来源不被信任，已拒绝')
}

function resolveSenderUrl(event: IpcMainInvokeEvent): string | undefined {
  try {
    const frame = event.senderFrame as { origin?: string, url?: string } | null
    return frame?.origin || frame?.url || undefined
  } catch {
    return undefined
  }
}
function isSenderTrusted(event: IpcMainInvokeEvent): boolean {
  // senderFrame.origin 需要 Electron 43；缺失时降级用 url，都取不到则按不可信处理（默认拒绝）
  const url = resolveSenderUrl(event)
  if (!url) return false
  return isTrustedIpcSenderUrl(url)
}

/**
 * 注册受保护的 IPC handler：仅允许应用自身页面调用。
 * 校验失败直接抛错，不进入业务逻辑。
 */
export function safeHandle(ipcMain: IpcMain, channel: string, handler: IpcHandler): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!isSenderTrusted(event)) {
      logger.warn('Blocked untrusted IPC call', { channel })
      throw createIpcForbiddenError()
    }
    return handler(event, ...args)
  })
}
