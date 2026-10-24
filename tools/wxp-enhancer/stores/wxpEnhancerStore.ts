import type { WxpClearLoginCacheResult, WxpDataCache, WxpRunningState, WxpSettings } from '../../../shared/wxp'
import { DEFAULT_WXP_SETTINGS } from '../../../shared/wxp'
import { invokeWxpCommand, onWxpCommand, wxpCommands } from '../api'

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
  const commands = wxpCommands()

  async function load(): Promise<void> {
    const data = await invokeWxpCommand<WxpGetAllResult>(commands.GET_ALL)
    if (data.settings) settings.value = data.settings
    running.value = data.running ?? null
    loginCacheClearPending.value = data.clearLoginCachePending === true
    await loadDataCache()
  }

  function bindStatusEvents(): () => void {
    const offStatus = onWxpCommand<WxpRunningState | null>(commands.EVENT_STATUS_CHANGED, (state) => {
      running.value = state
    })
    const offCache = onWxpCommand<WxpDataCache>(commands.EVENT_DATA_CACHE_UPDATED, (cache) => {
      if (cache) dataCache.value = cache
    })
    return () => {
      offStatus()
      offCache()
    }
  }

  async function saveSettings(patch: Partial<WxpSettings>): Promise<void> {
    settings.value = await invokeWxpCommand<WxpSettings>(commands.SAVE_SETTINGS, patch)
  }

  async function launch(): Promise<void> {
    running.value = await invokeWxpCommand<WxpRunningState>(commands.LAUNCH)
    // 首轮注入会消费「待清除登录缓存」标记，回读一次避免页面继续显示待清除
    await refreshClearPending().catch(() => {})
  }

  /** 重新读取待清除标记（启动成功后调用；失败不影响启动结果） */
  async function refreshClearPending(): Promise<void> {
    const data = await invokeWxpCommand<WxpGetAllResult>(commands.GET_ALL)
    loginCacheClearPending.value = data.clearLoginCachePending === true
  }

  async function stop(): Promise<void> {
    await invokeWxpCommand(commands.STOP)
    running.value = null
  }

  async function reinject(): Promise<number> {
    return invokeWxpCommand<number>(commands.REINJECT)
  }

  async function clearLoginCache(): Promise<WxpClearLoginCacheResult> {
    const result = await invokeWxpCommand<WxpClearLoginCacheResult>(commands.CLEAR_LOGIN_CACHE)
    loginCacheClearPending.value = result.pending === true
    return result
  }

  async function loadDataCache(): Promise<void> {
    dataCache.value = await invokeWxpCommand<WxpDataCache | null>(commands.GET_DATA_CACHE)
  }

  async function collectData(): Promise<WxpDataCache> {
    const result = await invokeWxpCommand<WxpDataCache>(commands.COLLECT_DATA)
    dataCache.value = result
    return result
  }

  async function detectExecutable(): Promise<string | null> {
    return invokeWxpCommand<string | null>(commands.DETECT_EXECUTABLE)
  }

  async function selectExecutable(): Promise<string | null> {
    return invokeWxpCommand<string | null>(commands.SELECT_EXECUTABLE)
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
