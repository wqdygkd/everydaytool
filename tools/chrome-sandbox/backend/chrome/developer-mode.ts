import type { Sandbox } from '../../../../shared/types.js'
import { readdir } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { pathExists, readJsonFile } from '../../../../backend/utils/file-ops.js'
import { logger } from '../../../../backend/utils/logger.js'
import { sleep } from '../../../../shared/sleep.js'
import { getSandboxProfilePath } from '../utils/path-helper.js'

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

interface DevToolsPrefs {
  extensions?: {
    ui?: {
      developer_mode?: boolean
    }
  }
}

export async function shouldSkipDeveloperModeSetup(sandbox: Sandbox): Promise<boolean> {
  if (sandbox.metadata?.developerModeEnabled) return true

  const profilePath = getSandboxProfilePath(sandbox.id)
  const sessionsDir = path.join(profilePath, 'Sessions')
  if (!await pathExists(sessionsDir)) return false

  const files = await readdir(sessionsDir)
  if (!files.some(file => file.startsWith('Session_'))) return false

  const prefs = await readJsonFile<DevToolsPrefs>(path.join(profilePath, 'Secure Preferences'), {})
  return prefs?.extensions?.ui?.developer_mode === true
}

async function waitForCdp(port: number, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) return true
    } catch {
      // Chrome still starting
    }
    await sleep(300)
  }
  return false
}

interface CdpMessage {
  id?: number
  error?: { message?: string }
  result?: Record<string, unknown>
}

async function cdpCall(wsUrl: string, method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  const id = 1
  return new Promise((resolve, reject) => {
    ws.addEventListener('message', (event) => {
      const message = JSON.parse((event as MessageEvent).data) as CdpMessage
      if (message.id !== id) return
      ws.close()
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)))
      else resolve(message.result ?? {})
    })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function cdpEval(wsUrl: string, expression: string): Promise<unknown> {
  const result = await cdpCall(wsUrl, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  return (result.result as { value?: unknown } | undefined)?.value
}

interface PageTarget {
  id?: string
  url?: string
  webSocketDebuggerUrl?: string
  type?: string
}

async function getBrowserWsUrl(port: number): Promise<string> {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { webSocketDebuggerUrl: string }
  return version.webSocketDebuggerUrl
}

async function listPageTargets(port: number): Promise<PageTarget[]> {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as PageTarget[]
  return list.filter(item => item.type === 'page')
}

async function waitForExtensionsTarget(
  port: number,
  targetId: string,
  timeoutMs = 8000,
): Promise<PageTarget | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pages = await listPageTargets(port)
    const target = pages.find(item => item.id === targetId)
      || pages.find(item => item.url?.startsWith('chrome://extensions'))
    if (target?.webSocketDebuggerUrl) return target
    await sleep(200)
  }
  return null
}

interface ExtensionsTab {
  targetId: string
  wsUrl: string
  browserWsUrl: string
}

async function createBackgroundExtensionsTab(port: number): Promise<ExtensionsTab> {
  const browserWsUrl = await getBrowserWsUrl(port)
  const result = await cdpCall(browserWsUrl, 'Target.createTarget', {
    url: 'chrome://extensions/',
    background: true,
  })
  const targetId = result.targetId as string

  const target = await waitForExtensionsTarget(port, targetId)
  if (!target?.webSocketDebuggerUrl) {
    throw new Error('Background extensions tab not found')
  }

  return {
    targetId: target.id || targetId,
    wsUrl: target.webSocketDebuggerUrl,
    browserWsUrl,
  }
}

async function waitForExtensionsTabsClosed(port: number, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const pages = await listPageTargets(port)
    if (!pages.some(item => item.url?.startsWith('chrome://extensions'))) return
    await sleep(100)
  }
}

async function closeExtensionsTab(port: number, browserWsUrl: string, targetId: string): Promise<void> {
  try {
    await cdpCall(browserWsUrl, 'Target.closeTarget', { targetId })
  } catch {
    // ignore
  }

  await waitForExtensionsTabsClosed(port)

  for (const item of await listPageTargets(port)) {
    if (item.url?.startsWith('chrome://extensions')) {
      await fetch(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(item.id as string)}`)
    }
  }
  await waitForExtensionsTabsClosed(port)
}

interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

async function restoreChromeWindow(port: number, { x, y, width, height }: WindowBounds): Promise<void> {
  try {
    const browserWsUrl = await getBrowserWsUrl(port)
    const pages = await listPageTargets(port)
    const page = pages.find(item => !item.url?.startsWith('chrome://extensions')) || pages[0]
    if (!page?.id) return

    const windowResult = await cdpCall(browserWsUrl, 'Browser.getWindowForTarget', {
      targetId: page.id,
    })
    const windowId = windowResult.windowId as number

    await cdpCall(browserWsUrl, 'Browser.setWindowBounds', {
      windowId,
      bounds: { left: x, top: y, width, height, windowState: 'normal' },
    })
  } catch (error) {
    logger.warn('Failed to restore Chrome window bounds', { error: (error as Error).message })
  }
}

const TOGGLE_SCRIPT = `(enable) => {
  const toggle = document.querySelector('extensions-manager')?.shadowRoot
    ?.querySelector('extensions-toolbar')?.shadowRoot?.querySelector('#devMode');
  if (!toggle) return { found: false, checked: false };
  if (enable && !toggle.checked) toggle.click();
  return { found: true, checked: !!toggle.checked };
}`

interface ToggleState {
  found: boolean
  checked: boolean
}

async function enableDeveloperModeOnTab(wsUrl: string): Promise<boolean> {
  const deadline = Date.now() + 10000
  let state: ToggleState = { found: false, checked: false }

  while (Date.now() < deadline) {
    state = (await cdpEval(wsUrl, `(${TOGGLE_SCRIPT})(false)`) as ToggleState) || state
    if (state.found) break
    await sleep(300)
  }

  if (state.found && state.checked) {
    logger.info('Extensions developer mode already enabled')
    return true
  }
  if (!state.found) {
    logger.warn('Developer mode toggle not found on chrome://extensions')
    return false
  }

  await cdpEval(wsUrl, `(${TOGGLE_SCRIPT})(true)`)
  await sleep(500)

  const verified = await cdpEval(wsUrl, `(${TOGGLE_SCRIPT})(false)`) as ToggleState
  if (verified?.found && verified.checked) {
    logger.info('Extensions developer mode enabled via CDP')
    return true
  }

  logger.warn('Failed to enable extensions developer mode via CDP', { state, verified })
  return false
}

export async function setupSandboxDeveloperMode(
  debugPort: number,
  windowBounds?: WindowBounds | null,
): Promise<boolean> {
  if (!debugPort || !await waitForCdp(debugPort)) {
    if (debugPort) logger.warn('CDP not ready, skip developer mode enable', { debugPort })
    return false
  }

  let tab: ExtensionsTab | null = null
  try {
    tab = await createBackgroundExtensionsTab(debugPort)
    return await enableDeveloperModeOnTab(tab.wsUrl)
  } catch (error) {
    logger.warn('Developer mode CDP flow failed', { error: (error as Error).message })
    return false
  } finally {
    if (tab) await closeExtensionsTab(debugPort, tab.browserWsUrl, tab.targetId)
    if (windowBounds) await restoreChromeWindow(debugPort, windowBounds)
  }
}
