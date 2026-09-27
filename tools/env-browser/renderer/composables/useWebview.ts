import type { EnvConfig } from '../stores/envStore'
import { buildAutoLoginScript } from '../shared/autoLoginScript'

export interface WebviewStatus {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

type WebviewTag = Omit<HTMLElement, 'addEventListener'> & {
  src: string
  partition: string
  getURL: () => string
  getTitle: () => string
  canGoBack: () => boolean
  canGoForward: () => boolean
  goBack: () => void
  goForward: () => void
  reload: () => void
  loadURL: (url: string) => Promise<void>
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
  openDevTools: () => void
  closeDevTools: () => void
  isDevToolsOpened: () => boolean
  addEventListener: (event: string, listener: (e: unknown) => void) => void
}

export function useWebview(
  getEnvById: (id: string) => EnvConfig | undefined,
) {
  const webviewRefs = ref<Map<string, WebviewTag>>(new Map())
  const webviewStatus = reactive<Record<string, WebviewStatus>>({})
  const loadingIds = ref<Set<string>>(new Set())
  const autoLoginTried = new Set<string>()

  function getPartition(env: EnvConfig) {
    return `persist:env-${env.id}`
  }

  async function triggerAutoLogin(id: string) {
    const env = getEnvById(id)
    if (!env) return
    const wv = webviewRefs.value.get(id)
    if (!wv) return
    try {
      loadingIds.value.add(id)
      const script = buildAutoLoginScript(env.username, env.password)
      const result = await wv.executeJavaScript(script, false) as {
        ok: boolean
        reason?: string
        submitted?: boolean
      } | undefined
      if (result?.ok) {
        if (result.submitted) ElMessage.success(`[${env.name}] 已自动登录`)
        else ElMessage.info(`[${env.name}] 已填充账号密码，请手动提交`)
      }
    } catch {
      // ignore
    } finally {
      loadingIds.value.delete(id)
    }
  }

  function attachWebviewEvents(id: string, wv: WebviewTag) {
    if (!webviewStatus[id]) {
      webviewStatus[id] = {
        url: getEnvById(id)?.url || '',
        title: '',
        loading: true,
        canGoBack: false,
        canGoForward: false,
      }
    }
    const env = getEnvById(id)
    const anyWv = wv as unknown as { __envBound?: boolean }
    if (anyWv.__envBound) return
    anyWv.__envBound = true

    wv.addEventListener('did-start-loading', () => {
      if (webviewStatus[id]) webviewStatus[id].loading = true
    })

    wv.addEventListener('did-stop-loading', () => {
      if (webviewStatus[id]) {
        webviewStatus[id].loading = false
        try {
          webviewStatus[id].canGoBack = wv.canGoBack()
          webviewStatus[id].canGoForward = wv.canGoForward()
        } catch {}
      }
    })

    wv.addEventListener('did-fail-load', (e: unknown) => {
      const ev = e as { errorCode?: number, errorDescription?: string, validatedURL?: string }
      if (ev && ev.errorCode && ev.errorCode !== -3) {
        if (webviewStatus[id]) webviewStatus[id].loading = false
        ElMessage.error(`加载失败: ${ev.errorDescription || ev.errorCode} (${ev.validatedURL || ''})`)
      }
    })

    wv.addEventListener('did-navigate-in-page', (e: unknown) => {
      const ev = e as { url: string }
      if (webviewStatus[id]) webviewStatus[id].url = ev.url
    })

    wv.addEventListener('page-title-updated', (e: unknown) => {
      const ev = e as { title: string }
      if (webviewStatus[id]) webviewStatus[id].title = ev.title
    })

    wv.addEventListener('dom-ready', async () => {
      if (webviewStatus[id]) {
        try {
          webviewStatus[id].url = wv.getURL()
          webviewStatus[id].title = wv.getTitle()
          webviewStatus[id].canGoBack = wv.canGoBack()
          webviewStatus[id].canGoForward = wv.canGoForward()
        } catch {}
      }
      if (env && env.autoLogin && !autoLoginTried.has(id)) {
        const curUrl = (() => {
          try {
            return wv.getURL()
          } catch {
            return ''
          }
        })()
        const isLoginLike = /login|signin|auth/i.test(curUrl)
        if (isLoginLike) {
          autoLoginTried.add(id)
          await triggerAutoLogin(id)
        } else {
          try {
            const hasPwd = await wv.executeJavaScript(
              '!!document.querySelector(\'input[type="password"]\')',
              false,
            ) as boolean
            if (hasPwd) {
              autoLoginTried.add(id)
              await triggerAutoLogin(id)
            }
          } catch {}
        }
      }
    })

    wv.addEventListener('did-navigate', (e: unknown) => {
      const ev = e as { url: string }
      if (webviewStatus[id]) webviewStatus[id].url = ev.url
      if (/login|signin|auth/i.test(ev.url)) autoLoginTried.delete(id)
    })

    wv.addEventListener('new-window' as unknown as string, (e: unknown) => {
      const ev = e as { url: string }
      if (ev.url) wv.src = ev.url
    })
  }

  function setWebviewRef(id: string, el: unknown) {
    if (!el) return
    const wv = el as WebviewTag
    if (webviewRefs.value.has(id) && webviewRefs.value.get(id) === wv) return
    webviewRefs.value.set(id, wv)
    attachWebviewEvents(id, wv)
    const env = getEnvById(id)
    if (env) {
      nextTick(() => {
        if (!wv.getURL() || wv.getURL() === 'about:blank') {
          void wv.loadURL(env.url).catch(() => {
            wv.src = env.url
          })
        }
      })
    }
  }

  function cleanup(id: string) {
    webviewRefs.value.delete(id)
    delete webviewStatus[id]
    autoLoginTried.delete(id)
  }

  return {
    webviewRefs,
    webviewStatus,
    loadingIds,
    getPartition,
    setWebviewRef,
    cleanup,
    triggerAutoLogin,
  }
}
