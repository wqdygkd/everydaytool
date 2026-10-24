// Tauri 子 Webview 桥。
// Rust 侧用 Tauri 子 Webview 承载真实页面（独立 WebView2 数据目录），这里负责：
// 创建 / 销毁 / 导航 / 脚本执行 / 位置同步 / 事件分发。
import { invokeDesktop, listenDesktop } from './tauri'

export interface WebviewBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WebviewCreateOptions extends WebviewBounds {
  id: string
  url: string
  profile?: string
  userAgent?: string
  disableWebSecurity?: boolean
  /** 内置注入预设（treease：接口拦截运行时） */
  preset?: 'treease'
}

export type WebviewEventKind = 'loading-start' | 'loading-stop' | 'navigate' | 'new-window' | 'title'

export interface WebviewEvent {
  id: string
  kind: WebviewEventKind
  url?: string | null
  title?: string | null
}

type WebviewListener = (event: WebviewEvent) => void

const listeners = new Map<string, Set<WebviewListener>>()
let unlisten: (() => void) | null = null
let busReady: Promise<void> | null = null

function ensureBus(): Promise<void> {
  if (!busReady) {
    busReady = listenDesktop<WebviewEvent>('edt:webview', (event) => {
      const payload = event.payload
      if (!payload?.id) return
      const set = listeners.get(payload.id)
      if (!set) return
      for (const listener of [...set]) {
        try {
          listener(payload)
        } catch (error) {
          console.error('[webview] listener failed', error)
        }
      }
    }).then((dispose) => {
      unlisten = dispose
    }).catch((error) => {
      console.error('[webview] failed to subscribe edt:webview', error)
    })
  }
  return busReady
}

export function onWebviewEvent(id: string, callback: WebviewListener): () => void {
  void ensureBus()
  const set = listeners.get(id) ?? new Set<WebviewListener>()
  set.add(callback)
  listeners.set(id, set)
  return () => {
    const current = listeners.get(id)
    if (!current) return
    current.delete(callback)
    if (current.size === 0) listeners.delete(id)
  }
}

function webviewCall<T = unknown>(op: string, args: Record<string, unknown>): Promise<T> {
  return invokeDesktop<T>('edt_webview', { op, args })
}

export async function createWebview(options: WebviewCreateOptions): Promise<void> {
  // 必须先确保事件监听已注册，否则快速加载的本地页面会丢掉 loading-stop（自动登录依赖它）
  await ensureBus()
  await webviewCall('create', { ...options })
}

export async function closeWebview(id: string): Promise<void> {
  await webviewCall('close', { id })
}

export async function setWebviewBounds(id: string, bounds: WebviewBounds): Promise<void> {
  await webviewCall('bounds', { id, ...bounds })
}

export async function setWebviewVisible(id: string, visible: boolean): Promise<void> {
  await webviewCall('visible', { id, visible })
}

export async function navigateWebview(id: string, url: string): Promise<void> {
  await webviewCall('navigate', { id, url })
}

export async function reloadWebview(id: string): Promise<void> {
  await webviewCall('reload', { id })
}

export async function backWebview(id: string): Promise<void> {
  await webviewCall('back', { id })
}

export async function forwardWebview(id: string): Promise<void> {
  await webviewCall('forward', { id })
}

export async function webviewUrl(id: string): Promise<string> {
  return webviewCall<string>('url', { id })
}

export async function setWebviewDevTools(id: string, open?: boolean): Promise<{ open: boolean }> {
  return webviewCall<{ open: boolean }>('devtools', { id, open })
}

interface EvalEnvelope {
  ok: boolean
  value?: unknown
  error?: string
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** 执行脚本并等待 Promise 结果（Rust 侧把异步结果落到 __edtEvalResults[key]，这里轮询取回） */
export async function evaluateInWebview<T = unknown>(id: string, script: string): Promise<T> {
  const first = await webviewCall<EvalEnvelope | string | null>('eval', { id, script })
  if (typeof first === 'string' && first.startsWith('PENDING:')) {
    const key = first.slice('PENDING:'.length)
    const pollScript = `window.__edtEvalResults && window.__edtEvalResults[${JSON.stringify(key)}]`
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      await delay(100)
      const polled = await webviewCall<EvalEnvelope | null>('eval', { id, script: pollScript })
      if (polled && polled.ok && polled.value != null) {
        const envelope = polled.value as EvalEnvelope
        if (envelope.ok) return envelope.value as T
        throw new Error(envelope.error || '脚本执行失败')
      }
    }
    throw new Error('脚本执行超时')
  }
  if (first && typeof first === 'object' && 'ok' in first) {
    if (!first.ok) throw new Error(first.error || '脚本执行失败')
    return first.value as T
  }
  return first as T
}

export function disposeWebviewBridge(): void {
  unlisten?.()
  unlisten = null
  busReady = null
  listeners.clear()
}
