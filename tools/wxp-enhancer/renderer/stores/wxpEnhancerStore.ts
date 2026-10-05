import type { WxpEnhancement, WxpOpenDevToolsPayload, WxpRunningState, WxpSettings, WxpTarget } from '../../../../shared/types'
import { invokeWxpIpc, onWxpIpc, wxpIpcChannels } from '@renderer/shared/ipc/useWxpIpc'
import { DEFAULT_WXP_SETTINGS } from '../../../../shared/types'

interface WxpGetAllResult {
  settings?: WxpSettings
  enhancements?: WxpEnhancement[]
  running?: WxpRunningState | null
}

export const useWxpEnhancerStore = defineStore('wxp-enhancer/store', () => {
  const settings = ref<WxpSettings>({ ...DEFAULT_WXP_SETTINGS })
  const enhancements = ref<WxpEnhancement[]>([])
  const running = ref<WxpRunningState | null>(null)
  const loading = ref(false)
  const channels = wxpIpcChannels()

  async function load(): Promise<void> {
    loading.value = true
    try {
      const data = await invokeWxpIpc<WxpGetAllResult>(channels.GET_ALL)
      if (data.settings) settings.value = data.settings
      enhancements.value = data.enhancements ?? []
      running.value = data.running ?? null
    } finally {
      loading.value = false
    }
  }

  function bindStatusEvents(): () => void {
    return onWxpIpc<WxpRunningState | null>(channels.EVENT_STATUS_CHANGED, (state) => {
      running.value = state
    })
  }

  async function saveSettings(patch: Partial<WxpSettings>): Promise<void> {
    settings.value = await invokeWxpIpc<WxpSettings>(channels.SAVE_SETTINGS, patch)
  }

  async function saveEnhancement(enhancement: WxpEnhancement): Promise<boolean> {
    const result = await invokeWxpIpc<{ enhancement: WxpEnhancement, applied: boolean }>(channels.ENHANCEMENT_SAVE, enhancement)
    const index = enhancements.value.findIndex(item => item.id === result.enhancement.id)
    if (index === -1) {
      enhancements.value.push(result.enhancement)
    } else {
      enhancements.value[index] = result.enhancement
    }
    return result.applied
  }

  async function deleteEnhancement(id: string): Promise<boolean> {
    const result = await invokeWxpIpc<{ enhancements: WxpEnhancement[], applied: boolean }>(channels.ENHANCEMENT_DELETE, id)
    enhancements.value = result.enhancements
    return result.applied
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

  async function detectExecutable(): Promise<string | null> {
    return invokeWxpIpc<string | null>(channels.DETECT_EXECUTABLE)
  }

  async function selectExecutable(): Promise<string | null> {
    return invokeWxpIpc<string | null>(channels.SELECT_EXECUTABLE)
  }

  async function fetchTargets(port: number): Promise<WxpTarget[]> {
    return invokeWxpIpc<WxpTarget[]>(channels.GET_TARGETS, port)
  }

  async function openDevTools(payload: WxpOpenDevToolsPayload): Promise<void> {
    await invokeWxpIpc(channels.OPEN_DEVTOOLS, payload)
  }

  return {
    settings,
    enhancements,
    running,
    loading,
    channels,
    load,
    bindStatusEvents,
    saveSettings,
    saveEnhancement,
    deleteEnhancement,
    launch,
    stop,
    reinject,
    detectExecutable,
    selectExecutable,
    fetchTargets,
    openDevTools,
  }
})
