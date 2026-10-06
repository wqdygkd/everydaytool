import type { WxpOpenDevToolsPayload } from '../../../../shared/types.js'
import { createRequire } from 'node:module'
import { logger } from '../../../../backend/utils/logger.js'
import { sleep } from '../../../../shared/sleep.js'
import { isAllowedDevToolsUrl } from './cdp-client.js'

const require = createRequire(import.meta.url)
const { BrowserWindow, session, shell } = require('electron') as typeof import('electron')

const devtoolsWindows = new Map<string, Electron.BrowserWindow>()
const pauseCountByPort = new Map<number, number>()

let devtoolsSession: Electron.Session | null = null

/**
 * DevTools 前端页发起的 WebSocket 会携带 Origin（http://127.0.0.1:port），
 * 而 Chromium 111+ 的调试服务对带 Origin 的连接直接 403（前端表现为
 * "debugging connection was closed"）。这里在专用 session 中剥掉 ws 升级
 * 请求的 Origin 头，兼容未带 --remote-allow-origins 启动的实例。
 */
function getDevtoolsSession(): Electron.Session {
  if (devtoolsSession) return devtoolsSession
  const ses = session.fromPartition('wxp-devtools', { cache: false })
  try {
    ses.webRequest.onBeforeSendHeaders(
      { urls: ['ws://127.0.0.1:*/*', 'ws://localhost:*/*'] },
      (details, callback) => {
        const requestHeaders = { ...details.requestHeaders }
        delete requestHeaders.Origin
        callback({ requestHeaders })
      },
    )
  } catch (error) {
    logger.warn('wxp:devtools origin-strip unavailable', { error: (error as Error).message })
  }
  devtoolsSession = ses
  return ses
}

// 注入会话可注册监听，在 DevTools 调试期间同步暂停/恢复注入
type DevtoolsPauseListener = (port: number, action: 'pause' | 'resume') => void

const pauseListeners = new Set<DevtoolsPauseListener>()

export function registerDevtoolsPauseListener(listener: DevtoolsPauseListener): () => void {
  pauseListeners.add(listener)
  return () => pauseListeners.delete(listener)
}

function notifyPauseListeners(port: number, action: 'pause' | 'resume'): void {
  for (const listener of pauseListeners) {
    try {
      listener(port, action)
    } catch {
      // 监听器异常不影响 DevTools 窗口本身
    }
  }
}

function extractPortFromDevToolsUrl(devToolsUrl: string): number | null {
  const match = devToolsUrl.match(/^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\//)
  return match ? Number(match[1]) : null
}

function retainPause(port: number): void {
  pauseCountByPort.set(port, (pauseCountByPort.get(port) ?? 0) + 1)
  notifyPauseListeners(port, 'pause')
}

function releasePause(port: number | null): void {
  if (port === null) return
  const current = pauseCountByPort.get(port) ?? 0
  if (current <= 0) return

  // 计数归零（所有 DevTools 窗口都已关闭）才通知恢复
  if (current === 1) {
    pauseCountByPort.delete(port)
    notifyPauseListeners(port, 'resume')
  } else {
    pauseCountByPort.set(port, current - 1)
  }
}

async function pauseInjection(port: number | null): Promise<void> {
  if (!port) return
  retainPause(port)
  await sleep(200)
}

function assertDevToolsUrl(devToolsUrl: string): void {
  if (!isAllowedDevToolsUrl(devToolsUrl)) {
    throw new Error('无效的 DevTools 地址')
  }
}

async function openDevToolsWindow(devToolsUrl: string, title = 'CDP 调试入口'): Promise<void> {
  assertDevToolsUrl(devToolsUrl)

  const existing = devtoolsWindows.get(devToolsUrl)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  const port = extractPortFromDevToolsUrl(devToolsUrl)
  await pauseInjection(port)

  const win = new BrowserWindow({
    title,
    width: 1280,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      session: getDevtoolsSession(),
    },
  })
  devtoolsWindows.set(devToolsUrl, win)

  win.on('closed', () => {
    devtoolsWindows.delete(devToolsUrl)
    releasePause(port)
  })

  try {
    await win.loadURL(devToolsUrl)
    logger.info('wxp:devtools opened', { devToolsUrl, port })
  } catch (error) {
    if (!win.isDestroyed()) {
      win.close()
    }
    devtoolsWindows.delete(devToolsUrl)
    releasePause(port)
    throw error
  }
}

async function openDevToolsExternal(devToolsUrl: string): Promise<void> {
  assertDevToolsUrl(devToolsUrl)

  const port = extractPortFromDevToolsUrl(devToolsUrl)
  await pauseInjection(port)
  await shell.openExternal(devToolsUrl)

  if (port) {
    setTimeout(releasePause, 30000, port)
  }
}

function parseOpenDevToolsPayload(payload: string | WxpOpenDevToolsPayload | null | undefined) {
  if (typeof payload === 'string') {
    return { devToolsUrl: payload, title: undefined, external: false, port: null }
  }

  return {
    devToolsUrl: payload?.devToolsUrl,
    title: payload?.title,
    external: payload?.external === true,
    port: payload?.port ?? null,
  }
}

export async function openDevToolsFromPayload(payload: string | WxpOpenDevToolsPayload): Promise<boolean> {
  const { devToolsUrl, title, external, port } = parseOpenDevToolsPayload(payload)

  if (port && !devToolsUrl) {
    await openDevToolsWindow(`http://127.0.0.1:${port}/`, title ?? `CDP 调试入口 · ${port}`)
    return true
  }

  if (!devToolsUrl) {
    throw new Error('无效的 DevTools 地址')
  }

  if (external) {
    await openDevToolsExternal(devToolsUrl)
  } else {
    await openDevToolsWindow(devToolsUrl, title)
  }

  return true
}
