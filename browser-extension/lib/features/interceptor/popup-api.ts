import type { FeatureBackgroundContext } from '../../shell/types.ts'
import { applyProxy, removeProxy } from './proxy.ts'
import { localSiteInfo } from './site-info-local.ts'
import {
  getProxyEnabled,
  interceptorState,
  setProxyEnabled,
} from './state.ts'
import { scriptSupported } from './user-scripts.ts'

type RuntimeMessage = {
  type?: string
  enabled?: boolean
  url?: string
  id?: string
  meta?: { scriptId?: string }
  level?: string
  message?: string
}

function reportProxyState(ctx: FeatureBackgroundContext, enabled: boolean, error?: string): void {
  ctx.send('interceptor', 'proxy-state', error ? { enabled, error } : { enabled })
}

async function buildPopupState(ctx: FeatureBackgroundContext) {
  const shell = ctx.getState()
  const proxyEnabled = await getProxyEnabled()
  return {
    connected: shell.connected,
    connecting: shell.connecting,
    lastError: interceptorState.lastError || shell.lastError,
    proxyEnabled,
    proxyPort: interceptorState.proxyPort,
    wsPort: shell.wsPort,
    appId: shell.appId,
    scriptSupported: scriptSupported(),
    targets: interceptorState.targets,
    rules: interceptorState.rules,
  }
}

export function registerPopupApi(ctx: FeatureBackgroundContext): () => void {
  const listener = (
    message: RuntimeMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean | undefined => {
    if (!message || typeof message.type !== 'string') return undefined

    if (message.type === 'script-log') {
      const meta = message.meta || {}
      ctx.send('interceptor', 'script-log', {
        scriptId: meta.scriptId || 'unknown',
        level: message.level || 'error',
        message: message.message || '',
      })
      return false
    }

    if (message.type === 'get-popup-state') {
      void buildPopupState(ctx).then(sendResponse)
      return true
    }

    if (message.type === 'set-proxy') {
      void (async () => {
        if (message.enabled) {
          if (!ctx.isConnected() || !interceptorState.proxyPort) {
            sendResponse({ ok: false, error: '尚未连接 edt' })
            return
          }
          await setProxyEnabled(true)
          await applyProxy(interceptorState.proxyPort)
          reportProxyState(ctx, true)
          sendResponse({ ok: true })
        }
        else {
          await setProxyEnabled(false)
          await removeProxy()
          reportProxyState(ctx, false)
          sendResponse({ ok: true })
        }
      })()
      return true
    }

    if (message.type === 'add-target') {
      const ok = ctx.send('interceptor', 'add-target', { url: message.url })
      sendResponse({ ok, error: ok ? undefined : '尚未连接 edt' })
      return false
    }

    if (message.type === 'get-site-info') {
      void (async () => {
        const url = String(message.url || '')
        const local = () => localSiteInfo(url)
        const connected = await ctx.ensureConnected(1200)
        if (!connected) {
          sendResponse({
            ok: false,
            local: true,
            error: '尚未连接 edt（请确认 everydaytool 正在运行），以下为扩展本地数据',
            ...local(),
          })
          return
        }

        let reply = await ctx.requestFromEdt('interceptor', 'site-info', { url }, 1500) as
          | { targets?: unknown[], related?: unknown[], rules?: unknown[] }
          | null
          | undefined
        if (reply === undefined || reply === null) {
          await ctx.forceReconnect(1500)
          reply = await ctx.requestFromEdt('interceptor', 'site-info', { url }, 1500) as
            | { targets?: unknown[], related?: unknown[], rules?: unknown[] }
            | null
            | undefined
        }
        if (reply === undefined || reply === null) {
          sendResponse({
            ok: false,
            local: true,
            error: 'edt 未响应站点查询（edt 可能是旧版，请重启后重载扩展），以下为扩展本地数据',
            ...local(),
          })
          return
        }
        sendResponse({
          ok: true,
          targets: reply.targets || [],
          related: reply.related || [],
          rules: reply.rules || [],
          total: interceptorState.targets.length,
        })
      })()
      return true
    }

    if (message.type === 'toggle-target' || message.type === 'toggle-rule') {
      const type = message.type === 'toggle-target' ? 'target-toggle' : 'rule-toggle'
      const ok = ctx.send('interceptor', type, {
        id: message.id,
        enabled: message.enabled === true,
      })
      sendResponse({ ok, error: ok ? undefined : '尚未连接 edt' })
      return false
    }

    if (message.type === 'remove-target-id' || message.type === 'remove-rule') {
      const type = message.type === 'remove-target-id' ? 'target-remove-id' : 'rule-remove'
      const ok = ctx.send('interceptor', type, { id: message.id })
      sendResponse({ ok, error: ok ? undefined : '尚未连接 edt' })
      return false
    }

    if (message.type === 'suggest-targets') {
      void (async () => {
        if (!(await ctx.ensureConnected(1200))) {
          sendResponse({ ok: false, error: '尚未连接 edt', hosts: [] })
          return
        }
        const result = await ctx.requestFromEdt(
          'interceptor',
          'target-suggest',
          { url: message.url },
          1500,
        ) as { hosts?: string[] } | null | undefined
        sendResponse({ ok: Boolean(result), hosts: result?.hosts || [] })
      })()
      return true
    }

    return undefined
  }

  chrome.runtime.onMessage.addListener(listener)
  return () => {
    chrome.runtime.onMessage.removeListener(listener)
  }
}

export { reportProxyState }
