// IPC 通道白名单校验（preload 与主进程共用）：
// preload 把 invoke/on 限制在当前命名空间登记的通道内，避免渲染层（含被注入脚本）
// 借用任一命名空间句柄调用其它域的通道（跨工具域越权）。
// 事件通道以通道表键名 EVENT_ 开头区分（主进程 → 渲染层推送），只允许注册监听、不允许调用。
export interface IpcChannels {
  [key: string]: string
}

function isRecord(value: unknown): value is IpcChannels {
  return typeof value === 'object' && value !== null
}

export function isAllowedIpcChannel(channels: IpcChannels, channel: unknown): boolean {
  if (typeof channel !== 'string' || !channel) return false
  if (!isRecord(channels)) return false
  return Object.values(channels).includes(channel)
}

export function isAllowedIpcEventChannel(channels: IpcChannels, channel: unknown): boolean {
  if (typeof channel !== 'string' || !channel) return false
  if (!isRecord(channels)) return false
  return Object.entries(channels).some(([key, value]) => key.startsWith('EVENT_') && value === channel)
}
