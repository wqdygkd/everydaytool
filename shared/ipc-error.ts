/**
 * Electron 的 ipcRenderer.invoke 在主进程 handler 抛错时会把 message 包成
 * `Error invoking remote method '<channel>': Error: <真实原因>`。
 * 这层包装对用户没有意义，展示前统一剥掉；业务错误本身保持不变。
 */
const REMOTE_INVOKE_PREFIX = /^(?:Error:\s*)?Error invoking remote method '[^']*':\s*(?:Error:\s*)?/i

export function normalizeIpcErrorMessage(message: string): string {
  return message.replace(REMOTE_INVOKE_PREFIX, '').trim()
}

/** 把跨进程 reject 的值收敛成 Error；剥掉包装时保留 cause / 原始栈 */
export function toIpcError(error: unknown): Error {
  if (error instanceof Error) {
    const normalized = normalizeIpcErrorMessage(error.message)
    if (normalized === error.message) return error
    const wrapped = new Error(normalized || '操作失败，请重试')
    wrapped.cause = error
    return wrapped
  }
  const text = normalizeIpcErrorMessage(typeof error === 'string' ? error : '')
  return new Error(text || '操作失败，请重试')
}
