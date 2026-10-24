// Tauri 事件总线：把 Rust 的 edt:event 分发到各工具域通道。
import type { TauriEvent } from './tauri'
import { listenDesktop } from './tauri'

type Listener = (payload: unknown) => void

const listeners = new Map<string, Set<Listener>>()
let busReady: Promise<void> | null = null

interface EdtEventPayload {
  channel: string
  payload: unknown
}

function ensureBus(): Promise<void> {
  if (!busReady) {
    busReady = listenDesktop<EdtEventPayload>('edt:event', (event: TauriEvent<EdtEventPayload>) => {
      const channel = event.payload?.channel
      if (!channel) return
      const set = listeners.get(channel)
      if (!set) return
      for (const listener of [...set]) {
        try {
          listener(event.payload?.payload)
        } catch (error) {
          console.error('[desktop] event listener failed', channel, error)
        }
      }
    }).then(() => {}).catch((error) => {
      console.error('[desktop] failed to subscribe edt:event', error)
    })
  }
  return busReady
}

export function subscribeDesktopEvent(channel: string, callback: Listener): () => void {
  void ensureBus()
  const set = listeners.get(channel) ?? new Set<Listener>()
  set.add(callback)
  listeners.set(channel, set)
  return () => {
    const current = listeners.get(channel)
    if (!current) return
    current.delete(callback)
    if (current.size === 0) listeners.delete(channel)
  }
}
