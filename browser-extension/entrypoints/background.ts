import { FEATURES } from '../lib/features/registry.ts'
import { ExtensionShell } from '../lib/shell/ws-client.ts'

export default defineBackground(() => {
  const shell = new ExtensionShell(FEATURES)
  shell.start()

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return undefined
    const type = (message as { type?: string }).type

    if (type === 'get-shell-state') {
      sendResponse(shell.getState())
      return false
    }

    if (type === 'shell-reconnect') {
      void shell.reconnect().then(() => sendResponse({ ok: true })).catch((error: unknown) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      })
      return true
    }

    return undefined
  })
})
