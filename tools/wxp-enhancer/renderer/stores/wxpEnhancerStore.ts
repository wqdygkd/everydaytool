import type {
  WxpChannelLink,
  WxpChannelSnapshot,
  WxpChannelToggleResult,
  WxpClearLoginCacheResult,
  WxpDataCache,
  WxpRunningState,
  WxpSettings,
} from '../../../../shared/wxp'
import { DEFAULT_WXP_SETTINGS } from '../../../../shared/wxp'
import { invokeWxpIpc, onWxpIpc, wxpIpcChannels } from '../ipc'

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
  /** 通道快照：只读镜像，不落盘（状态事实在 WXP 主进程里） */
  const channelSnapshot = ref<WxpChannelSnapshot | null>(null)
  /** 用户固定的医院；空串 = 跟随 WXP 当前医院 */
  const channelHospital = ref('')

  // 网页预览没有 preload。通道只在真正调用 IPC 时读取，避免 store 初始化阶段直接抛错。
  function channels(): Record<string, string> {
    return wxpIpcChannels()
  }

  async function load(): Promise<void> {
    const data = await invokeWxpIpc<WxpGetAllResult>(channels().GET_ALL)
    if (data.settings) settings.value = data.settings
    running.value = data.running ?? null
    loginCacheClearPending.value = data.clearLoginCachePending === true
    await loadDataCache()
  }

  function bindStatusEvents(): () => void {
    const offStatus = onWxpIpc<WxpRunningState | null>(channels().EVENT_STATUS_CHANGED, (state) => {
      running.value = state
    })
    const offCache = onWxpIpc<WxpDataCache>(channels().EVENT_DATA_CACHE_UPDATED, (cache) => {
      if (cache) dataCache.value = cache
    })
    return () => {
      offStatus()
      offCache()
    }
  }

  async function saveSettings(patch: Partial<WxpSettings>): Promise<void> {
    settings.value = await invokeWxpIpc<WxpSettings>(channels().SAVE_SETTINGS, patch)
  }

  async function launch(): Promise<void> {
    running.value = await invokeWxpIpc<WxpRunningState>(channels().LAUNCH)
    // 首轮注入会消费「待清除登录缓存」标记，回读一次避免页面继续显示待清除
    await refreshClearPending().catch(() => {})
  }

  /** 重新读取待清除标记（启动成功后调用；失败不影响启动结果） */
  async function refreshClearPending(): Promise<void> {
    const data = await invokeWxpIpc<WxpGetAllResult>(channels().GET_ALL)
    loginCacheClearPending.value = data.clearLoginCachePending === true
  }

  async function stop(): Promise<void> {
    await invokeWxpIpc(channels().STOP)
    running.value = null
  }

  async function clearLoginCache(): Promise<WxpClearLoginCacheResult> {
    const result = await invokeWxpIpc<WxpClearLoginCacheResult>(channels().CLEAR_LOGIN_CACHE)
    loginCacheClearPending.value = result.pending === true
    return result
  }

  async function loadDataCache(): Promise<void> {
    dataCache.value = await invokeWxpIpc<WxpDataCache | null>(channels().GET_DATA_CACHE)
  }

  /** 读通道快照：空医院 = 跟随 WXP 当前医院；页面每 3s 调一次，端口集合每次都新鲜 */
  async function loadChannels(): Promise<WxpChannelSnapshot> {
    const snapshot = await invokeWxpIpc<WxpChannelSnapshot>(channels().GET_CHANNELS, channelHospital.value)
    channelSnapshot.value = snapshot
    // 固定过的医院已不在租户列表里（换账号 / 权限变化）：回到跟随 WXP 当前医院
    if (channelHospital.value && !snapshot.hospitals.some(h => h.code === channelHospital.value)) {
      channelHospital.value = ''
    }
    return snapshot
  }

  async function selectChannelHospital(code: string): Promise<void> {
    channelHospital.value = code
    await loadChannels()
  }

  /** 建立 / 关闭通道：医院以快照为准（列表行属于哪家医院，就操作哪家） */
  async function toggleChannel(link: WxpChannelLink, action: 'open' | 'close'): Promise<WxpChannelToggleResult> {
    const hospitalCode = channelSnapshot.value?.hospitalCode ?? ''
    if (!hospitalCode) throw new Error('尚未读取到转发连接，请先连接 WXP 并选择医院')
    // 行对象来自响应式快照（Proxy）：IPC 结构化克隆不认 Proxy，先拍平成纯对象再传
    const plainLink: WxpChannelLink = {
      id: link.id,
      name: link.name,
      simpleName: link.simpleName,
      sceneformal: link.sceneformal,
      accessPoint: link.accessPoint,
      targetPoint: link.targetPoint,
      localIp: link.localIp,
      localPort: link.localPort,
      relIp: link.relIp,
      relPort: link.relPort,
      browsetype: link.browsetype,
      operaPort: link.operaPort,
      protocol: link.protocol,
      urlSuffix: link.urlSuffix,
      canOpen: link.canOpen,
      online: link.online,
    }
    return invokeWxpIpc<WxpChannelToggleResult>(
      action === 'open' ? channels().OPEN_CHANNEL : channels().CLOSE_CHANNEL,
      { hospitalCode, link: plainLink },
    )
  }

  // 断开 WXP 后通道状态全部失效（端口只活在那个进程里），清空避免继续显示「启用」
  watch(running, (state) => {
    if (!state || state.status !== 'running') {
      channelSnapshot.value = null
      channelHospital.value = ''
    }
  })

  async function collectData(): Promise<WxpDataCache> {
    const result = await invokeWxpIpc<WxpDataCache>(channels().COLLECT_DATA)
    dataCache.value = result
    return result
  }

  async function detectExecutable(): Promise<string | null> {
    return invokeWxpIpc<string | null>(channels().DETECT_EXECUTABLE)
  }

  async function selectExecutable(): Promise<string | null> {
    return invokeWxpIpc<string | null>(channels().SELECT_EXECUTABLE)
  }

  return {
    settings,
    running,
    loginCacheClearPending,
    dataCache,
    channels: channelSnapshot,
    channelHospital,
    load,
    bindStatusEvents,
    saveSettings,
    launch,
    stop,
    clearLoginCache,
    collectData,
    loadChannels,
    selectChannelHospital,
    toggleChannel,
    detectExecutable,
    selectExecutable,
  }
})
