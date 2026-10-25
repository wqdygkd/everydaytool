// 平台级 IPC 安全封装：统一校验调用方来源，避免渲染层（含被注入脚本、远程页面）
// 借用 preload 句柄越权调用主进程能力。工具域注册 handler 时用 safeHandle 替代 ipcMain.handle。
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { isTrustedIpcSenderUrl } from './ipc-sender.ts'
import { logger } from './logger.ts'

export type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown

/** invoke（handle）与单向消息（on）共用的发送方校验最小形状 */
type IpcEventLike = IpcMainEvent | IpcMainInvokeEvent

/** 调用方来源不允许时抛出的错误（渲染层侧统一提示，不暴露内部细节） */
export function createIpcForbiddenError(): Error {
  return new Error('IPC 调用来源不被信任，已拒绝')
}

// 打包后渲染页是 file://.../app.asar/dist/index.html，校验 file: 来源时必须用
// app.getAppPath() 做前缀比对；electron/main.ts 在注册任何 handler 之前注入。
let trustedAppPath: string | undefined

export function initIpcSafety(options: { appPath?: string }): void {
  trustedAppPath = options.appPath?.trim() || undefined
}

function resolveSenderUrls(event: IpcEventLike): string[] {
  const urls: string[] = []
  try {
    const frame = event.senderFrame as { origin?: string, url?: string } | null
    // file: 页面的 origin 是不透明源（"null"/"file://"），不带路径，必须用 url 判；
    // http(s) 的 origin 则更干净。两个候选有一个通过即信任。
    if (frame?.url) urls.push(frame.url)
    if (frame?.origin) urls.push(frame.origin)
    const contentsUrl = (event.sender as { getURL?: () => string } | null)?.getURL?.()
    if (contentsUrl) urls.push(contentsUrl)
  } catch {
    // 取不到则按不可信处理（默认拒绝）
  }
  return urls
}
function isSenderTrusted(event: IpcEventLike): boolean {
  const candidates = resolveSenderUrls(event)
  if (candidates.length === 0) return false
  return candidates.some(url => isTrustedIpcSenderUrl(url, { appPath: trustedAppPath }))
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

/**
 * 单向消息（ipcMain.on）的受保护版本：与 safeHandle 共用同一份可信发送方白名单。
 * 不可信来源直接丢弃，不进入业务逻辑（页面外跳等旁路不能绕过来源校验）。
 */
export function safeOn(ipcMain: IpcMain, channel: string, handler: (event: IpcMainEvent, ...args: any[]) => void): void {
  ipcMain.on(channel, (event: IpcMainEvent, ...args: unknown[]) => {
    if (!isSenderTrusted(event)) {
      logger.warn('Blocked untrusted IPC event', { channel })
      return
    }
    handler(event, ...args)
  })
}
