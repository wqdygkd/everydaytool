// 环境浏览器子 Webview 桥：使用 Tauri child webview（Rust webviews.rs）。
// 对外仍暴露与原 WebviewTag 同名的方法（getURL / loadURL / executeJavaScript / goBack ...），
// 页面逻辑无需改动；差异只在创建方式与事件来源。
import type { EnvConfig } from '../stores/envStore'
import {
  backWebview,
  closeWebview,
  createWebview,
  evaluateInWebview,
  forwardWebview,
  navigateWebview,
  onWebviewEvent,
  reloadWebview,
  setWebviewBounds,
  setWebviewDevTools,
  setWebviewVisible,
} from '@/desktop/webviews'
import { buildAutoLoginScript } from '../shared/autoLoginScript'

export interface WebviewStatus {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

/** 与 Tauri 子 Webview 对齐的最小方法集 */
export interface WebviewTag {
  getURL: () => string
  getTitle: () => string
  canGoBack: () => boolean
  canGoForward: () => boolean
  goBack: () => void
  goForward: () => void
  reload: () => void
  loadURL: (url: string) => Promise<void>
  executeJavaScript: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>
  openDevTools: () => void
  closeDevTools: () => void
  isDevToolsOpened: () => boolean
}

// 环境浏览器的 UA 在迁移前就是固定的桌面 Chrome UA（绕过部分站点的移动端重定向）
const ENV_BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

class WebviewHandle implements WebviewTag {
  url: string
  title = ''
  devtoolsOpen = false
  backStack: string[] = []
  forwardStack: string[] = []
  navigationIntent: 'back' | 'forward' | null = null

  constructor(public readonly id: string, initialUrl: string) {
    this.url = initialUrl
  }

  getURL(): string {
    return this.url
  }

  getTitle(): string {
    return this.title
  }

  canGoBack(): boolean {
    return this.backStack.length > 0
  }

  canGoForward(): boolean {
    return this.forwardStack.length > 0
  }

  goBack(): void {
    if (!this.backStack.length) return
    this.backStack.pop()
    if (this.url) this.forwardStack.push(this.url)
    this.navigationIntent = 'back'
    void backWebview(this.id).catch(() => {
      this.navigationIntent = null
    })
  }

  goForward(): void {
    if (!this.forwardStack.length) return
    this.forwardStack.pop()
    if (this.url) this.backStack.push(this.url)
    this.navigationIntent = 'forward'
    void forwardWebview(this.id).catch(() => {
      this.navigationIntent = null
    })
  }

  reload(): void {
    void reloadWebview(this.id).catch(() => {})
  }

  async loadURL(url: string): Promise<void> {
    await navigateWebview(this.id, url)
  }

  executeJavaScript<T = unknown>(code: string, _userGesture?: boolean): Promise<T> {
    return evaluateInWebview<T>(this.id, code)
  }

  openDevTools(): void {
    void setWebviewDevTools(this.id, true).then((state) => {
      this.devtoolsOpen = state.open
    }).catch(() => {})
  }

  closeDevTools(): void {
    void setWebviewDevTools(this.id, false).then(() => {
      this.devtoolsOpen = false
    }).catch(() => {})
  }

  isDevToolsOpened(): boolean {
    return this.devtoolsOpen
  }
}

export function useWebview(
  getEnvById: (id: string) => EnvConfig | undefined,
) {
  const webviewRefs = ref<Map<string, WebviewTag>>(new Map())
  const webviewStatus = reactive<Record<string, WebviewStatus>>({})
  const loadingIds = ref<Set<string>>(new Set())
  const autoLoginTried = new Set<string>()
  const autoLoginPending = new Set<string>()

  const hosts = new Map<string, HTMLElement>()
  const observers = new Map<string, ResizeObserver>()
  const unsubscribers = new Map<string, () => void>()
  const syncFrames = new Map<string, number>()
  const pendingCleanup = new Map<string, ReturnType<typeof setTimeout>>()

  function getPartition(env: EnvConfig) {
    return `persist:env-${env.id}`
  }

  function patchStatus(id: string, patch: Partial<WebviewStatus>) {
    const status = webviewStatus[id]
    if (status) Object.assign(status, patch)
  }

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

  async function hasPasswordInput(handle: WebviewTag): Promise<boolean> {
    try {
      return Boolean(await handle.executeJavaScript('!!document.querySelector(\'input[type="password"]\')', false))
    } catch {
      return false
    }
  }

  async function triggerAutoLogin(id: string) {
    const env = getEnvById(id)
    if (!env) return
    const handle = webviewRefs.value.get(id)
    if (!handle) return
    try {
      loadingIds.value.add(id)
      const script = buildAutoLoginScript(env.username, env.password)
      const result = await handle.executeJavaScript(script) as {
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

  function updateNavigationButtons(id: string) {
    const handle = webviewRefs.value.get(id)
    if (!handle) return
    patchStatus(id, {
      canGoBack: handle.canGoBack(),
      canGoForward: handle.canGoForward(),
    })
  }

  /**
   * 自动登录：dom-ready 时刻表单可能尚未就绪（尤其 SPA / 慢路由），
   * 因此按 600ms 间隔最多重试 3 次；同源校验与「只尝试一次」语义保持不变。
   */
  async function tryAutoLogin(id: string, env: EnvConfig, attempt = 0): Promise<void> {
    if (!env.autoLogin || autoLoginTried.has(id) || autoLoginPending.has(id)) return
    autoLoginPending.add(id)
    try {
      const handle = webviewRefs.value.get(id)
      if (!handle) return
      const currentUrl = handle.getURL()
      if (!isSameOriginAs(env, currentUrl)) {
        autoLoginTried.add(id)
        ElMessage.warning(`[${env.name}] 页面已跳转到其它站点，已跳过自动登录`)
        return
      }
      const isLoginLike = /login|signin|auth/i.test(currentUrl)
      if (isLoginLike || await hasPasswordInput(handle)) {
        autoLoginTried.add(id)
        await triggerAutoLogin(id)
        return
      }
      if (attempt < 2) {
        setTimeout(() => {
          void tryAutoLogin(id, env, attempt + 1)
        }, 600)
      }
    } finally {
      autoLoginPending.delete(id)
    }
  }

  function handleWebviewEvent(
    id: string,
    handle: WebviewHandle,
    event: { kind: string, url?: string | null, title?: string | null },
  ) {
    const env = getEnvById(id)
    switch (event.kind) {
      case 'loading-start':
        patchStatus(id, { loading: true })
        break
      case 'loading-stop': {
        patchStatus(id, { loading: false, title: handle.title || webviewStatus[id]?.title || '' })
        updateNavigationButtons(id)
        if (env) void tryAutoLogin(id, env)
        break
      }
      case 'navigate': {
        const next = event.url || ''
        const previous = handle.url
        if (handle.navigationIntent) {
          handle.navigationIntent = null
        } else if (previous && next && previous !== next) {
          handle.backStack.push(previous)
          handle.forwardStack = []
        }
        handle.url = next
        patchStatus(id, { url: next })
        if (/login|signin|auth/i.test(next)) autoLoginTried.delete(id)
        updateNavigationButtons(id)
        // 页面加载事件在部分 WebView2 场景下可能早于表单渲染：导航/标题事件也触发一次带重试的自动登录
        if (env?.autoLogin) {
          setTimeout(() => {
            void tryAutoLogin(id, env, 1)
          }, 500)
        }
        break
      }
      case 'title':
        handle.title = event.title || ''
        patchStatus(id, { title: handle.title })
        if (env?.autoLogin) {
          setTimeout(() => {
            void tryAutoLogin(id, env, 1)
          }, 300)
        }
        break
      case 'new-window': {
        const target = event.url || ''
        if (!target) break
        if (!isSameOriginAs(getEnvById(id), target)) {
          ElMessage.warning('弹窗指向其它站点，已阻止在环境浏览器内打开')
          break
        }
        void handle.loadURL(target).catch(() => {})
        break
      }
    }
  }

  function syncBounds(id: string) {
    const host = hosts.get(id)
    const handle = webviewRefs.value.get(id)
    if (!host || !handle) return
    const rect = host.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) {
      void setWebviewVisible(id, false).catch(() => {})
      return
    }
    void setWebviewBounds(id, {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }).catch(() => {})
  }

  function scheduleSync(id: string) {
    if (syncFrames.has(id)) return
    const frame = requestAnimationFrame(() => {
      syncFrames.delete(id)
      syncBounds(id)
    })
    syncFrames.set(id, frame)
  }

  function scheduleSyncAll() {
    for (const id of hosts.keys()) scheduleSync(id)
  }

  function observeHost(id: string, host: HTMLElement) {
    observers.get(id)?.disconnect()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => scheduleSync(id))
    observer.observe(host)
    observers.set(id, observer)
  }

  async function ensureWebview(id: string) {
    if (webviewRefs.value.has(id)) return
    const env = getEnvById(id)
    if (!env) return
    const host = hosts.get(id)
    if (!host) return

    const handle = new WebviewHandle(id, env.url)
    webviewRefs.value.set(id, handle)
    if (!webviewStatus[id]) {
      webviewStatus[id] = {
        url: env.url,
        title: '',
        loading: true,
        canGoBack: false,
        canGoForward: false,
      }
    }

    unsubscribers.set(id, onWebviewEvent(id, event => handleWebviewEvent(id, handle, event)))

    const rect = host.getBoundingClientRect()
    try {
      await createWebview({
        id,
        url: env.url,
        profile: `env-${id}`,
        userAgent: ENV_BROWSER_UA,
        preset: 'env-browser',
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      })
      observeHost(id, host)
      scheduleSync(id)
    } catch (error) {
      ElMessage.error(`[${env.name}] 浏览器内核创建失败：${(error as Error).message}`)
    }
  }

  /** 绑定宿主 div：创建 webview 并开始同步位置 */
  function setWebviewRef(id: string, el: unknown) {
    const timeout = pendingCleanup.get(id)
    if (timeout !== undefined) {
      clearTimeout(timeout)
      pendingCleanup.delete(id)
    }

    if (!el) {
      hosts.delete(id)
      observers.get(id)?.disconnect()
      observers.delete(id)
      void setWebviewVisible(id, false).catch(() => {})
      // tab 关闭 / 组件重渲染：下一轮若仍未重新挂载，则真正销毁 webview
      const handle = setTimeout(() => {
        pendingCleanup.delete(id)
        if (!hosts.has(id)) cleanup(id)
      }, 0)
      pendingCleanup.set(id, handle)
      return
    }

    const host = el as HTMLElement
    if (hosts.get(id) === host) return
    hosts.set(id, host)
    void ensureWebview(id)
    scheduleSync(id)
  }

  function cleanup(id: string) {
    unsubscribers.get(id)?.()
    unsubscribers.delete(id)
    observers.get(id)?.disconnect()
    observers.delete(id)
    const frame = syncFrames.get(id)
    if (frame !== undefined) cancelAnimationFrame(frame)
    syncFrames.delete(id)
    hosts.delete(id)
    webviewRefs.value.delete(id)
    delete webviewStatus[id]
    autoLoginTried.delete(id)
    loadingIds.value.delete(id)
    void closeWebview(id).catch(() => {})
  }

  function cleanupAll() {
    for (const id of [...new Set([...hosts.keys(), ...webviewRefs.value.keys()])]) cleanup(id)
  }

  function onWindowResize() {
    scheduleSyncAll()
  }

  window.addEventListener('resize', onWindowResize)
  document.addEventListener('scroll', scheduleSyncAll, true)

  onScopeDispose(() => {
    window.removeEventListener('resize', onWindowResize)
    document.removeEventListener('scroll', scheduleSyncAll, true)
  })

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
