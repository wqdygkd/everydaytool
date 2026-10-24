// 自绘标题栏的窗口控制（Tauri decorations(false)）。
// 全部经 Tauri command 执行；状态通过 edt:window-state 事件同步（最大化 / 还原图标）。
import { invokeDesktop, listenDesktop } from './tauri'

export interface WindowState {
  maximized: boolean
  fullscreen: boolean
}

export type WindowAction = 'minimize' | 'toggle-maximize' | 'close' | 'toggle-fullscreen'

export async function getWindowState(): Promise<WindowState> {
  return invokeDesktop<WindowState>('edt_window_state')
}

export async function windowAction(action: WindowAction): Promise<WindowState> {
  return invokeDesktop<WindowState>('edt_window_action', { action })
}

export function subscribeWindowState(callback: (state: WindowState) => void): Promise<() => void> {
  return listenDesktop<WindowState>('edt:window-state', event => callback(event.payload))
}
