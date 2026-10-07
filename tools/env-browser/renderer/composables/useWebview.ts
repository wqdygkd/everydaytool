import type { EnvConfig } from '../stores/envStore'
import { buildAutoLoginScript } from '../shared/autoLoginScript'

export interface WebviewStatus {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

export type WebviewTag = Omit<HTMLElement, 'addEventListener'> & {
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
  // webview 监听器引用：cleanup 时必须逐个 removeEventListener，
  // 否则关闭/重开环境后旧监听器仍持有已卸载的回调与状态
  const webviewListeners = new Map<string, Array<[string, (e: unknown) => void]>>()

  function getPartition(env: EnvConfig) {
    return `persist:env-${env.id}`
  }

  function patchStatus(id: string, patch: Partial<WebviewStatus>) {
    const status = webviewStatus[id]
    if (status) Object.assign(status, patch)
  }

  function safeGetUrl(wv: WebviewTag): string {
    try {
      return wv.getURL()
    } catch {
      return ''
    }
  }

  /**
   * 取 URL 的 origin（小写、去掉默认端口差异）；解析失败返回 null。
   * 用于自动登录与弹窗的同源校验：凭据只投递给环境配置的目标站点。
   */
  function originOf(rawUrl: string): string | null {
    if (!rawUrl) return null
    try {
      return new URL(rawUrl).origin
    } catch {
      return null
    }
  }

  function isSameOriginAs(env: EnvConfig | undefined, rawUrl: string): boolean {
    if (!env) return false
    const configured = originOf(env.url)
    const current = originOf(rawUrl)
    if (!configured || !current) return false
    return configured === current
  }

  async function hasPasswordInput(wv: WebviewTag): Promise<boolean> {
    try {
      return Boolean(await wv.executeJavaScript('!!document.querySelector(\'input[type="password"]\')', false))
    } catch {
      return false
    }
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

    const listeners: Array<[string, (e: unknown) => void]> = []
    const on = (event: string, listener: (e: unknown) => void) => {
      wv.addEventListener(event, listener)
      listeners.push([event, listener])
    }

    on('did-start-loading', () => {
      patchStatus(id, { loading: true })
    })

    on('did-stop-loading', () => {
      patchStatus(id, { loading: false })
      try {
        patchStatus(id, { canGoBack: wv.canGoBack(), canGoForward: wv.canGoForward() })
      } catch {}
    })

    on('did-fail-load', (e: unknown) => {
      const ev = e as { errorCode?: number, errorDescription?: string, validatedURL?: string }
      if (ev?.errorCode && ev.errorCode !== -3) {
        patchStatus(id, { loading: false })
        ElMessage.error(`加载失败: ${ev.errorDescription || ev.errorCode} (${ev.validatedURL || ''})`)
      }
    })

    on('did-navigate-in-page', (e: unknown) => {
      const ev = e as { url: string }
      patchStatus(id, { url: ev.url })
    })

    on('page-title-updated', (e: unknown) => {
      const ev = e as { title: string }
      patchStatus(id, { title: ev.title })
    })

    on('dom-ready', async () => {
      try {
        patchStatus(id, {
          url: wv.getURL(),
          title: wv.getTitle(),
          canGoBack: wv.canGoBack(),
          canGoForward: wv.canGoForward(),
        })
      } catch {}
      if (!env || !env.autoLogin || autoLoginTried.has(id)) return
      // 同源校验：站点发生跳转 / 开放重定向后不得把账号密码投递到其它域名
      const currentUrl = safeGetUrl(wv)
      if (!isSameOriginAs(env, currentUrl)) {
        autoLoginTried.add(id)
        ElMessage.warning(`[${env.name}] 页面已跳转到其它站点，已跳过自动登录`)
        return
      }
      const isLoginLike = /login|signin|auth/i.test(currentUrl)
      if (isLoginLike || (await hasPasswordInput(wv))) {
        autoLoginTried.add(id)
        await triggerAutoLogin(id)
      }
    })

    on('did-navigate', (e: unknown) => {
      const ev = e as { url: string }
      patchStatus(id, { url: ev.url })
      if (/login|signin|auth/i.test(ev.url)) autoLoginTried.delete(id)
    })

    on('new-window', (e: unknown) => {
      const ev = e as { url: string }
      if (!ev?.url) return
      // 弹窗可能是任意站点的跳转 / 开放重定向：跨域一律不在 webview 内打开，避免凭据被带过去
      if (!isSameOriginAs(getEnvById(id), ev.url)) {
        ElMessage.warning('弹窗指向其它站点，已阻止在环境浏览器内打开')
        return
      }
      wv.src = ev.url
    })

    webviewListeners.set(id, listeners)
  }

  function setWebviewRef(id: string, el: unknown) {
    if (!el) return
    const wv = el as WebviewTag
    if (webviewRefs.value.get(id) === wv) return
    webviewRefs.value.set(id, wv)
    attachWebviewEvents(id, wv)
    const env = getEnvById(id)
    if (!env) return
    nextTick(() => {
      const current = wv.getURL()
      if (!current || current === 'about:blank') {
        void wv.loadURL(env.url).catch(() => {
          wv.src = env.url
        })
      }
    })
  }

  /** 解绑单个环境：移除监听器、清空状态（删除环境或关闭页面时调用） */
  function cleanup(id: string) {
    const wv = webviewRefs.value.get(id)
    const listeners = webviewListeners.get(id)
    if (wv && listeners) {
      for (const [event, listener] of listeners) {
        try {
          (wv as unknown as { removeEventListener?: (e: string, l: (ev: unknown) => void) => void })
            .removeEventListener?.(event, listener)
        } catch {
          // webview 可能已销毁
        }
      }
    }
    webviewListeners.delete(id)
    webviewRefs.value.delete(id)
    delete webviewStatus[id]
    autoLoginTried.delete(id)
    loadingIds.value.delete(id)
  }

  /** 页面卸载：释放全部环境的监听器与状态 */
  function cleanupAll() {
    for (const id of [...webviewListeners.keys()]) {
      cleanup(id)
    }
  }

  return {
    webviewRefs,
    webviewStatus,
    loadingIds,
    getPartition,
    setWebviewRef,
    cleanup,
    cleanupAll,
    triggerAutoLogin,
  }
}
