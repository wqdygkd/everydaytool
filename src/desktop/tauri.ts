// Tauri 官方 JS API 封装：invoke/listen 全部走 @tauri-apps/api，
// 不再依赖 withGlobalTauri 注入的 window.__TAURI__。
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export interface TauriEvent<T> {
  event: string
  id: number
  payload: T
}

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function invokeDesktop<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriEnvironment()) throw new Error('当前不在 everydaytool 桌面端中运行')
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    // Rust 的 Result::Err(String) 在 JS 侧是字符串而非 Error，统一成 Error 便于 UI 显示。
    if (error instanceof Error) throw error
    throw new Error(typeof error === 'string' ? error : `桌面调用失败：${JSON.stringify(error)}`)
  }
}

export function listenDesktop<T = unknown>(
  event: string,
  handler: (event: TauriEvent<T>) => void,
): Promise<() => void> {
  if (!isTauriEnvironment()) return Promise.resolve(() => {})
  return listen<T>(event, handler)
}
