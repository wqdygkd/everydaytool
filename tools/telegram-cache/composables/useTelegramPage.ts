import { onBeforeUnmount, ref, watch } from 'vue'
// Telegram Web A 内嵌页（Tauri 子 Webview 桥）：
// - 子 Webview 是独立窗口层，按宿主元素几何摆放并跟随 resize 同步；
// - 导航闸由 Rust 侧 preset: 'telegram' 兜住（只允许 Telegram 域名，其余外链交系统浏览器）；
// - 观测在页面内只读采集（PerformanceObserver 语义），由宿主轮询取回再上报，不改写请求。
import { openExternal } from '@/desktop/platform'
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

export const TELEGRAM_WEBVIEW_ID = 'telegram-web'
const TELEGRAM_PROFILE = 'telegram-cache'
export const TELEGRAM_DEFAULT_URL = 'https://web.telegram.org/a/'
/** 观测轮询间隔：资源计时是汇总数据，2s 足够且不会给页面加负担 */
const OBSERVE_INTERVAL_MS = 2_000

export function useTelegramPage() {
  const host = ref<HTMLElement | null>(null)
  const created = ref(false)
  const loading = ref(true)
  const pageUrl = ref(TELEGRAM_DEFAULT_URL)
  const loadError = ref('')
  const devtoolsOpen = ref(false)

  let observer: ResizeObserver | null = null
  let offEvent: (() => void) | null = null
  let syncFrame: number | null = null
  let observeTimer: ReturnType<typeof setInterval> | null = null

  function bounds() {
    const element = host.value
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }

  function syncBounds() {
    if (!created.value) return
    const box = bounds()
    if (!box) return
    if (box.width < 2 || box.height < 2) {
      void setWebviewVisible(TELEGRAM_WEBVIEW_ID, false).catch(() => {})
      return
    }
    void setWebviewVisible(TELEGRAM_WEBVIEW_ID, true).catch(() => {})
    void setWebviewBounds(TELEGRAM_WEBVIEW_ID, box).catch(() => {})
  }

  function scheduleSync() {
    if (syncFrame !== null) return
    syncFrame = requestAnimationFrame(() => {
      syncFrame = null
      syncBounds()
    })
  }

  async function ensure() {
    if (created.value || !host.value) return
    created.value = true
    offEvent = onWebviewEvent(TELEGRAM_WEBVIEW_ID, (event) => {
      if (event.kind === 'loading-start') {
        loading.value = true
      } else if (event.kind === 'loading-stop') {
        loading.value = false
        syncBounds()
      } else if (event.kind === 'navigate' || event.kind === 'title') {
        if (event.url) pageUrl.value = event.url
        loading.value = false
      } else if (event.kind === 'new-window' && event.url) {
        // 导航闸把非 Telegram 域名转成 new-window：交系统浏览器，宿主不开新窗
        openExternal(event.url)
      }
    })
    const box = bounds()
    try {
      await createWebview({
        id: TELEGRAM_WEBVIEW_ID,
        url: TELEGRAM_DEFAULT_URL,
        profile: TELEGRAM_PROFILE,
        preset: 'telegram',
        ...(box ?? { x: 0, y: 0, width: 0, height: 0 }),
      })
      scheduleSync()
    } catch (error) {
      created.value = false
      loadError.value = (error as Error).message || '内嵌页面创建失败'
    }
  }

  async function destroy() {
    offEvent?.()
    offEvent = null
    stopObservation()
    if (!created.value) return
    created.value = false
    await closeWebview(TELEGRAM_WEBVIEW_ID).catch(() => {})
  }

  function reload() {
    loadError.value = ''
    loading.value = true
    void reloadWebview(TELEGRAM_WEBVIEW_ID).catch(() => {})
  }

  function goBack() {
    void backWebview(TELEGRAM_WEBVIEW_ID).catch(() => {})
  }

  function goForward() {
    void forwardWebview(TELEGRAM_WEBVIEW_ID).catch(() => {})
  }

  function navigate(url: string) {
    void navigateWebview(TELEGRAM_WEBVIEW_ID, url).catch(() => {})
  }

  async function toggleDevTools() {
    try {
      const state = await setWebviewDevTools(TELEGRAM_WEBVIEW_ID, !devtoolsOpen.value)
      devtoolsOpen.value = state.open
    } catch (error) {
      loadError.value = (error as Error).message || '无法打开开发者工具'
    }
  }

  /** 在页面里执行只读脚本（观测采集 / 探测都走这里） */
  function runScript<T = unknown>(script: string): Promise<T> {
    return evaluateInWebview<T>(TELEGRAM_WEBVIEW_ID, script)
  }

  /**
   * 观测轮询：按游标取回新增资源计时条目并上报。
   * `report` 由调用方提供（store.reportObservations），保证「脚本来源 + 上报」都在桌面壳契约内。
   */
  function startObservation(report: (runScriptFn: (script: string) => Promise<unknown>) => Promise<void>) {
    stopObservation()
    observeTimer = setInterval(() => {
      void report(runScript as (script: string) => Promise<unknown>).catch(() => {})
    }, OBSERVE_INTERVAL_MS)
  }

  function stopObservation() {
    if (observeTimer) {
      clearInterval(observeTimer)
      observeTimer = null
    }
  }

  watch(host, (element) => {
    observer?.disconnect()
    observer = null
    if (!element) {
      void destroy()
      return
    }
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => scheduleSync())
      observer.observe(element)
    }
    scheduleSync()
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    if (syncFrame !== null) cancelAnimationFrame(syncFrame)
    void destroy()
  })

  return {
    host,
    created,
    loading,
    pageUrl,
    loadError,
    devtoolsOpen,
    ensure,
    destroy,
    reload,
    goBack,
    goForward,
    navigate,
    toggleDevTools,
    runScript,
    startObservation,
    stopObservation,
    syncBounds: scheduleSync,
  }
}
