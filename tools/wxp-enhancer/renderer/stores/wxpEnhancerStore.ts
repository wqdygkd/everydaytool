import type { WxpClearLoginCacheResult, WxpDataCache, WxpRunningState, WxpSettings } from '../../../../shared/types'
import { invokeWxpIpc, onWxpIpc, wxpIpcChannels } from '@renderer/shared/ipc/useWxpIpc'
import { DEFAULT_WXP_SETTINGS } from '../../../../shared/types'

interface WxpGetAllResult {
  settings?: WxpSettings
  running?: WxpRunningState | null
  clearLoginCachePending?: boolean
}

export const useWxpEnhancerStore = defineStore('wxp-enhancer/store', () => {
  const settings = ref<WxpSettings>({ ...DEFAULT_WXP_SETTINGS })
  const running = ref<WxpRunningState | null>(null)
  const loginCacheClearPending = ref(false)
  const dataCache = ref<WxpDataCache | null>(null)
  const channels = wxpIpcChannels()

  async function load(): Promise<void> {
    const data = await invokeWxpIpc<WxpGetAllResult>(channels.GET_ALL)
    if (data.settings) settings.value = data.settings
    running.value = data.running ?? null
    loginCacheClearPending.value = data.clearLoginCachePending === true
    await loadDataCache()
  }

  function bindStatusEvents(): () => void {
    return onWxpIpc<WxpRunningState | null>(channels.EVENT_STATUS_CHANGED, (state) => {
      running.value = state
    })
  }

  async function saveSettings(patch: Partial<WxpSettings>): Promise<void> {
    settings.value = await invokeWxpIpc<WxpSettings>(channels.SAVE_SETTINGS, patch)
  }

  async function launch(): Promise<void> {
    running.value = await invokeWxpIpc<WxpRunningState>(channels.LAUNCH)
  }

  async function stop(): Promise<void> {
    await invokeWxpIpc(channels.STOP)
    running.value = null
  }

  async function reinject(): Promise<number> {
    return invokeWxpIpc<number>(channels.REINJECT)
  }

  async function clearLoginCache(): Promise<WxpClearLoginCacheResult> {
    const result = await invokeWxpIpc<WxpClearLoginCacheResult>(channels.CLEAR_LOGIN_CACHE)
    loginCacheClearPending.value = result.pending === true
    return result
  }

  async function loadDataCache(): Promise<void> {
    dataCache.value = await invokeWxpIpc<WxpDataCache | null>(channels.GET_DATA_CACHE)
  }

  async function collectData(): Promise<WxpDataCache> {
    const result = await invokeWxpIpc<WxpDataCache>(channels.COLLECT_DATA)
    dataCache.value = result
    return result
  }

  async function detectExecutable(): Promise<string | null> {
    return invokeWxpIpc<string | null>(channels.DETECT_EXECUTABLE)
  }

  async function selectExecutable(): Promise<string | null> {
    return invokeWxpIpc<string | null>(channels.SELECT_EXECUTABLE)
  }

  return {
    settings,
    running,
    loginCacheClearPending,
    dataCache,
    load,
    bindStatusEvents,
    saveSettings,
    launch,
    stop,
    reinject,
    clearLoginCache,
    collectData,
    detectExecutable,
    selectExecutable,
  }
})
