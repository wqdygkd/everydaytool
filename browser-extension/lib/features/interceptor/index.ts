import type { FeatureBackgroundContext, FeatureDefinition } from '../../shell/types.ts'
import type {
  InjectedScript,
  InterceptorRuleSummary,
  InterceptorTarget,
} from '../../../../shared/interceptor.ts'
import { registerPopupApi, reportProxyState } from './popup-api.ts'
import { applyProxy, removeProxy, setBadge } from './proxy.ts'
import {
  applyBootstrap,
  getProxyEnabled,
  interceptorState,
  setLastError,
  setProxyEnabled,
} from './state.ts'
import { syncUserScripts } from './user-scripts.ts'

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
}

async function failOpenProxy(ctx: FeatureBackgroundContext, reason?: string): Promise<void> {
  const enabled = await getProxyEnabled()
  if (enabled) {
    await removeProxy()
    reportProxyState(ctx, false, reason || 'edt 连接断开，已自动恢复直连')
  }
  else {
    setBadge(false)
  }
}

async function bootstrapFeature(ctx: FeatureBackgroundContext, bootstrap: unknown): Promise<void> {
  applyBootstrap(bootstrap)
  await syncUserScripts(interceptorState.scripts)
  const enabled = await getProxyEnabled()
  if (enabled && interceptorState.proxyPort) {
    await applyProxy(interceptorState.proxyPort)
    reportProxyState(ctx, true)
  }
  else {
    await failOpenProxy(ctx)
  }
  ctx.notifyPopup()
}

export const interceptorFeature: FeatureDefinition = {
  id: 'interceptor',
  label: '拦截器',
  popupTab: {
    id: 'interceptor',
    label: '拦截器',
  },
  setupBackground(ctx, bootstrap) {
    const unsubs = [
      ctx.onEnvelope('interceptor', 'targets-sync', (payload) => {
        const data = asRecord(payload)
        interceptorState.targets = Array.isArray(data.targets) ? data.targets as InterceptorTarget[] : []
        ctx.notifyPopup()
      }),
      ctx.onEnvelope('interceptor', 'rules-sync', (payload) => {
        const data = asRecord(payload)
        interceptorState.rules = Array.isArray(data.rules) ? data.rules as InterceptorRuleSummary[] : []
        ctx.notifyPopup()
      }),
      ctx.onEnvelope('interceptor', 'scripts-sync', (payload) => {
        const data = asRecord(payload)
        interceptorState.scripts = Array.isArray(data.scripts) ? data.scripts as InjectedScript[] : []
        void syncUserScripts(interceptorState.scripts)
      }),
      ctx.onEnvelope('interceptor', 'proxy-port', (payload) => {
        const data = asRecord(payload)
        interceptorState.proxyPort = typeof data.proxyPort === 'number' ? data.proxyPort : null
        void (async () => {
          const enabled = await getProxyEnabled()
          if (enabled && interceptorState.proxyPort) await applyProxy(interceptorState.proxyPort)
          ctx.notifyPopup()
        })()
      }),
      ctx.onEnvelope('interceptor', 'set-proxy', (payload) => {
        const data = asRecord(payload)
        void (async () => {
          try {
            if (data.enabled && interceptorState.proxyPort) {
              await setProxyEnabled(true)
              await applyProxy(interceptorState.proxyPort)
              reportProxyState(ctx, true)
            }
            else {
              await setProxyEnabled(false)
              await removeProxy()
              reportProxyState(ctx, false)
            }
            ctx.notifyPopup()
          }
          catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            setLastError(`代理设置失败：${message}`)
            ctx.notifyPopup()
          }
        })()
      }),
      // requestFromEdt 已按 requestId 收口；此处保留订阅以便调试 / 后续扩展
      ctx.onEnvelope('interceptor', 'site-info-result', () => {}),
      ctx.onEnvelope('interceptor', 'target-suggest-result', () => {}),
    ]

    const unregPopup = registerPopupApi(ctx)
    void bootstrapFeature(ctx, bootstrap).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(`启动失败：${message}`)
      ctx.notifyPopup()
    })

    return () => {
      for (const unsub of unsubs) unsub()
      unregPopup()
      void failOpenProxy(ctx).catch(() => {})
    }
  },
}
