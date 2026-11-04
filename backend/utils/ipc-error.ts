// 平台级 IPC 错误收敛：handler 抛出的错误最终要经 preload 进入渲染层的 toast / 行内提示，
// 这里负责把 Node / 网络错误翻译成可直接展示的中文，原始细节留给日志。
import { normalizeIpcErrorMessage } from '../../shared/ipc-error.ts'

const CODE_HINTS: Record<string, string> = {
  ENOENT: '文件或目录不存在',
  EACCES: '没有权限访问该文件或目录',
  EPERM: '没有权限执行该操作',
  EBUSY: '文件正被其它程序占用',
  ENOSPC: '磁盘空间不足',
  ECONNREFUSED: '连接被拒绝，目标服务可能未启动',
  ECONNRESET: '连接已被对方断开',
  EPIPE: '连接已断开',
  ENOTFOUND: '无法解析域名，请检查网络或代理',
  EAI_AGAIN: 'DNS 解析失败，请检查网络或代理',
  ETIMEDOUT: '连接超时，请检查网络或代理',
  ABORT_ERR: '操作已超时',
  UND_ERR_CONNECT_TIMEOUT: '连接超时，请检查网络或代理',
}

const HAN_CHARACTER = /[\u4E00-\u9FFF]/

/** 错误码（含 undici 放在 cause 里的形态） */
function resolveErrorCode(error: unknown): string | undefined {
  const err = error as { code?: unknown, cause?: { code?: unknown } }
  const candidates = [err?.code, err?.cause?.code]
  return candidates.find((value): value is string => typeof value === 'string' && value.length > 0)
}

/**
 * 把 IPC handler 抛出的错误收敛成用户可读的一句话：
 * - 已是中文的业务错误原样保留（工具侧最清楚怎么描述）
 * - Node / 网络错误按 code 映射成可执行提示
 * - 其余情况保留原始 message，至少不丢信息
 */
export function toReadableIpcMessage(error: unknown): string {
  if (typeof error === 'string') {
    const text = normalizeIpcErrorMessage(error)
    return text || '操作失败，请重试'
  }
  const raw = error instanceof Error ? normalizeIpcErrorMessage(error.message) : ''
  if (raw && HAN_CHARACTER.test(raw)) return raw
  const code = resolveErrorCode(error)
  if (code && CODE_HINTS[code]) return CODE_HINTS[code]
  return raw || '操作失败，请重试'
}
