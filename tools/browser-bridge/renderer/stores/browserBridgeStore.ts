import type { IpcInvokeApi } from '@renderer/shared/ipc/types'
// 浏览器桥渲染层状态：IPC 拉取 + 事件订阅（状态 / 名单 / 流量增量为推送；脚本已并入规则）。
import type {
  BridgeRule,
  BridgeRuntimeStatus,
  BridgeTarget,
  CaStatus,
  TargetMatchType,
  TrafficEntry,
} from '../../../../shared/browser-bridge'
import { createIpcHelpers } from '@renderer/shared/ipc/createIpcHelpers'
import { defineStore } from 'pinia'

const { getApi } = createIpcHelpers('browserBridge', '浏览器桥')

export interface CaActionResult {
  ok: boolean
  canceled?: boolean
  detail?: string
  status: CaStatus
}

function api(): IpcInvokeApi {
  return getApi()
}

export const useBrowserBridgeStore = defineStore('browser-bridge/state', () => {
  const status = ref<BridgeRuntimeStatus | null>(null)
  const ca = ref<CaStatus | null>(null)
  const targets = ref<BridgeTarget[]>([])
  const rules = ref<BridgeRule[]>([])
  const traffic = ref<TrafficEntry[]>([])
  const ready = ref(false)

  /** 流量一键建规则：TrafficPanel 投递草稿，RulesPanel 监听后打开编辑器 */
  const ruleEditorDraft = ref<BridgeRule | null>(null)

  let disposers: Array<() => void> = []
  let initialized = false

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    const ipc = api()
    const channels = ipc.channels

    disposers.push(ipc.on(channels.EVENT_STATUS, (payload) => {
      status.value = payload as BridgeRuntimeStatus
    }))
    disposers.push(ipc.on(channels.EVENT_TARGETS, (payload) => {
      targets.value = payload as BridgeTarget[]
    }))
    disposers.push(ipc.on(channels.EVENT_TRAFFIC, (payload) => {
      traffic.value.push(payload as TrafficEntry)
      if (traffic.value.length > 1000) traffic.value.splice(0, traffic.value.length - 1000)
    }))

    const [runtimeStatus, caStatus, targetList, ruleList, trafficList] = await Promise.all([
      ipc.invoke(channels.STATUS_GET),
      ipc.invoke(channels.CA_STATUS_GET),
      ipc.invoke(channels.TARGETS_GET),
      ipc.invoke(channels.RULES_GET),
      ipc.invoke(channels.TRAFFIC_GET),
    ])
    status.value = runtimeStatus as BridgeRuntimeStatus
    ca.value = caStatus as CaStatus
    targets.value = targetList as BridgeTarget[]
    rules.value = ruleList as BridgeRule[]
    traffic.value = trafficList as TrafficEntry[]
    ready.value = true
  }

  function dispose(): void {
    for (const off of disposers) off()
    disposers = []
    initialized = false
  }

  async function refreshCa(force = false): Promise<void> {
    const channels = api().channels
    ca.value = (await api().invoke(channels.CA_STATUS_GET, force)) as CaStatus
  }

  async function installCa(): Promise<CaActionResult> {
    const channels = api().channels
    const result = (await api().invoke(channels.CA_INSTALL)) as CaActionResult
    ca.value = result.status
    return result
  }

  async function uninstallCa(): Promise<CaActionResult> {
    const channels = api().channels
    const result = (await api().invoke(channels.CA_UNINSTALL)) as CaActionResult
    ca.value = result.status
    return result
  }

  async function exportCa(): Promise<string | null> {
    const channels = api().channels
    return (await api().invoke(channels.CA_EXPORT)) as string | null
  }

  async function addTarget(host: string, port: number | undefined, matchType: TargetMatchType): Promise<void> {
    const channels = api().channels
    targets.value = (await api().invoke(channels.TARGETS_ADD, host, port, matchType)) as BridgeTarget[]
  }

  async function removeTarget(targetId: string): Promise<void> {
    const channels = api().channels
    targets.value = (await api().invoke(channels.TARGETS_REMOVE, targetId)) as BridgeTarget[]
  }

  async function upsertRule(rule: BridgeRule): Promise<void> {
    const channels = api().channels
    rules.value = (await api().invoke(channels.RULES_UPSERT, rule)) as BridgeRule[]
  }

  async function deleteRule(ruleId: string): Promise<void> {
    const channels = api().channels
    rules.value = (await api().invoke(channels.RULES_DELETE, ruleId)) as BridgeRule[]
  }

  async function clearTraffic(): Promise<void> {
    const channels = api().channels
    await api().invoke(channels.TRAFFIC_CLEAR)
    traffic.value = []
  }

  async function setProxyDesired(enabled: boolean): Promise<boolean> {
    const channels = api().channels
    return (await api().invoke(channels.PROXY_SET_DESIRED, enabled)) as boolean
  }

  async function openExtensionDir(): Promise<boolean> {
    const channels = api().channels
    return (await api().invoke(channels.EXTENSION_OPEN_DIR)) as boolean
  }

  function openRuleEditorFromTraffic(entry: TrafficEntry): void {
    ruleEditorDraft.value = {
      id: crypto.randomUUID(),
      name: `${entry.method} ${entry.path.slice(0, 40)}`,
      enabled: true,
      type: 'response',
      source: { key: 'url', operator: 'equals', value: entry.url },
      response: {
        mock: true,
        statusCode: entry.status ?? 200,
        ...(entry.responseBody ? { bodyReplace: entry.responseBody } : {}),
      },
      updatedAt: new Date().toISOString(),
    }
  }

  return {
    status,
    ca,
    targets,
    rules,
    traffic,
    ready,
    ruleEditorDraft,
    init,
    dispose,
    refreshCa,
    installCa,
    uninstallCa,
    exportCa,
    addTarget,
    removeTarget,
    upsertRule,
    deleteRule,
    clearTraffic,
    setProxyDesired,
    openExtensionDir,
    openRuleEditorFromTraffic,
  }
})
