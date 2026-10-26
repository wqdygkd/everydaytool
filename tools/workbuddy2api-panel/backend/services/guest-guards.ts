import type { WebContents } from 'electron'
// webview 导航闸：仅 workbuddy2api-panel 分区；本机 panel 内导航放行，OAuth / 外链 openExternal。
import { app, session, shell } from 'electron'
import { logger } from '../../../../backend/utils/logger.ts'
import { WB2API_WEBVIEW_PARTITION } from '../../../../shared/webview.ts'

const guarded = new WeakSet<WebContents>()

function isLocalPanelUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  } catch {
    return false
  }
}

function openExternalSafely(raw: string): void {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    void shell.openExternal(url.toString())
  } catch (error) {
    logger.warn('wb2api openExternal failed', { error: (error as Error).message })
  }
}

function attachGuards(guest: WebContents): void {
  if (guarded.has(guest)) return
  guarded.add(guest)

  const onWillNavigate = (event: Electron.Event, url: string) => {
    if (isLocalPanelUrl(url)) return
    event.preventDefault()
    openExternalSafely(url)
  }

  guest.on('will-navigate', onWillNavigate)
  guest.setWindowOpenHandler(({ url }) => {
    if (isLocalPanelUrl(url)) return { action: 'allow' }
    openExternalSafely(url)
    return { action: 'deny' }
  })

  guest.once('destroyed', () => {
    guest.removeListener('will-navigate', onWillNavigate)
  })
}

export function installWb2apiGuestGuards(): void {
  const wbSession = session.fromPartition(WB2API_WEBVIEW_PARTITION)
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return
    if (contents.session !== wbSession) return
    attachGuards(contents)
  })
}
