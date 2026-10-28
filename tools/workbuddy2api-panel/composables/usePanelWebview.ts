import { onBeforeUnmount, ref, watch } from 'vue'
// workbuddy2api-panel 内嵌面板：Tauri 子 Webview 承载上游 `/panel/`。
//
// 与 Electron 版 `<webview partition>` 的差异只在「怎么建」：Tauri 的子 Webview 是独立
// 窗口层，无法内嵌进 DOM 节点，因此这里按宿主元素的几何位置摆放并跟随 resize 同步
// （与 env-browser / treease 同一套桥，见 src/desktop/webviews.ts）。
//
// 导航闸：面板只允许在本机地址内跳转；新窗口 / 外链一律交系统浏览器（与 Electron 版
// guest-guards 同一语义）。
import { openExternal } from '@/desktop/platform'
import {
  closeWebview,
  createWebview,
  navigateWebview,
  onWebviewEvent,
  setWebviewBounds,
  setWebviewVisible,
} from '@/desktop/webviews'

const PANEL_WEBVIEW_ID = 'workbuddy-panel'
/** 面板 session 目录名（<数据目录>/webview-profiles/workbuddy2api-panel） */
const PANEL_PROFILE = 'workbuddy2api-panel'

function isLocalUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  } catch {
    return false
  }
}

export function usePanelWebview() {
  /** 宿主元素：面板就摆在这个 div 的位置上 */
  const host = ref<HTMLElement | null>(null)
  const created = ref(false)
  let observer: ResizeObserver | null = null
  let currentUrl = ''
  let offEvent: (() => void) | null = null
  let syncFrame: number | null = null

  function syncBounds() {
    const element = host.value
    if (!element || !created.value) return
    const rect = element.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) {
      void setWebviewVisible(PANEL_WEBVIEW_ID, false).catch(() => {})
      return
    }
    void setWebviewVisible(PANEL_WEBVIEW_ID, true).catch(() => {})
    void setWebviewBounds(PANEL_WEBVIEW_ID, {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }).catch(() => {})
  }

  function scheduleSync() {
    if (syncFrame !== null) return
    syncFrame = requestAnimationFrame(() => {
      syncFrame = null
      syncBounds()
    })
  }

  async function ensure(url: string) {
    if (!host.value) return
    if (created.value) {
      // 端口变了（改了 run/config.json）：沿用同一个 Webview，只换地址
      if (currentUrl !== url) {
        currentUrl = url
        await navigateWebview(PANEL_WEBVIEW_ID, url).catch(() => {})
      }
      return
    }
    created.value = true
    currentUrl = url
    offEvent = onWebviewEvent(PANEL_WEBVIEW_ID, (event) => {
      if (event.kind !== 'new-window' || !event.url) return
      // 面板里的外链（OAuth / 文档）交给系统浏览器，宿主不新开窗口
      if (!isLocalUrl(event.url)) openExternal(event.url)
    })
    try {
      await createWebview({
        id: PANEL_WEBVIEW_ID,
        url,
        profile: PANEL_PROFILE,
        preset: 'workbuddy',
        ...boundsOf(host.value),
      })
      scheduleSync()
    } catch (error) {
      created.value = false
      console.error('[wb2api] 创建面板 Webview 失败', error)
    }
  }

  async function destroy() {
    offEvent?.()
    offEvent = null
    if (!created.value) return
    created.value = false
    currentUrl = ''
    await closeWebview(PANEL_WEBVIEW_ID).catch(() => {})
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

  // 窗口 / 页签切换导致宿主隐没时把子 Webview 一起藏起来，避免浮在别的页面上
  watch([host, created], () => scheduleSync())

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    if (syncFrame !== null) cancelAnimationFrame(syncFrame)
    void destroy()
  })

  return { host, created, ensure, destroy, syncBounds: scheduleSync }
}

function boundsOf(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}
