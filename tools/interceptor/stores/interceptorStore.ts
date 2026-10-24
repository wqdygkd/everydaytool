// 拦截器渲染层状态：command 拉取 + 事件订阅（状态 / 名单 / 流量增量为推送；脚本已并入规则）。
import type {
  CaStatus,
  InterceptorRule,
  InterceptorRuntimeStatus,
  InterceptorTarget,
  InterceptorTargetPatch,
  ProxyPortUpdateResult,
  TrafficEntry,
} from '../../../shared/interceptor'
import type { CommandApi } from '@/shared/commands/types'
import { defineStore } from 'pinia'
import { createCommandHelpers } from '@/shared/commands/createCommandHelpers'

const { getApi } = createCommandHelpers('interceptor', '拦截器')

export interface CaActionResult {
  ok: boolean
  canceled?: boolean
  detail?: string
  status: CaStatus
}

export interface AddTargetResult {
  targets: InterceptorTarget[]
  /** 归一后的条目（nil = 输入无法解析） */
  target: InterceptorTarget | null
  /** true = 已有同「域 + 端口 + 匹配方式」的条目，本次只同步开关，没有新增行 */
  existed: boolean
}

function api(): CommandApi {
  return getApi()
}

export const useInterceptorStore = defineStore('interceptor/state', () => {
  const status = ref<InterceptorRuntimeStatus | null>(null)
  const ca = ref<CaStatus | null>(null)
  const targets = ref<InterceptorTarget[]>([])
  const rules = ref<InterceptorRule[]>([])
  const traffic = ref<TrafficEntry[]>([])
  const ready = ref(false)

  /** 流量一键建规则：TrafficPanel 投递草稿，RulesPanel 监听后打开编辑器 */
  const ruleEditorDraft = ref<InterceptorRule | null>(null)

  let disposers: Array<() => void> = []
  let initialized = false

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    const commandApi = api()
    const commands = commandApi.commands

    disposers.push(commandApi.on(commands.EVENT_STATUS, (payload) => {
      status.value = payload as InterceptorRuntimeStatus
    }))
    disposers.push(commandApi.on(commands.EVENT_TARGETS, (payload) => {
      targets.value = payload as InterceptorTarget[]
    }))
    disposers.push(commandApi.on(commands.EVENT_TRAFFIC, (payload) => {
      traffic.value.push(payload as TrafficEntry)
      if (traffic.value.length > 1000) traffic.value.splice(0, traffic.value.length - 1000)
    }))

    const [runtimeStatus, caStatus, targetList, ruleList, trafficList] = await Promise.all([
      commandApi.invoke(commands.STATUS_GET),
      commandApi.invoke(commands.CA_STATUS_GET),
      commandApi.invoke(commands.TARGETS_GET),
      commandApi.invoke(commands.RULES_GET),
      commandApi.invoke(commands.TRAFFIC_GET),
    ])
    status.value = runtimeStatus as InterceptorRuntimeStatus
    ca.value = caStatus as CaStatus
    targets.value = targetList as InterceptorTarget[]
    rules.value = ruleList as InterceptorRule[]
    traffic.value = trafficList as TrafficEntry[]
    ready.value = true
  }

  function dispose(): void {
    for (const off of disposers) off()
    disposers = []
    initialized = false
  }

  async function refreshCa(force = false): Promise<void> {
    const commands = api().commands
    ca.value = (await api().invoke(commands.CA_STATUS_GET, force)) as CaStatus
  }

  async function installCa(): Promise<CaActionResult> {
    const commands = api().commands
    const result = (await api().invoke(commands.CA_INSTALL)) as CaActionResult
    ca.value = result.status
    return result
  }

  async function uninstallCa(): Promise<CaActionResult> {
    const commands = api().commands
    const result = (await api().invoke(commands.CA_UNINSTALL)) as CaActionResult
    ca.value = result.status
    return result
  }

  async function exportCa(): Promise<string | null> {
    const commands = api().commands
    return (await api().invoke(commands.CA_EXPORT)) as string | null
  }

  /** 加入名单：入参是一个 origin（`https://www.a.com` / `http://127.0.0.1:8089`） */
  async function addTarget(origin: string): Promise<AddTargetResult> {
    const commands = api().commands
    const result = (await api().invoke(commands.TARGETS_ADD, origin)) as AddTargetResult
    targets.value = result.targets
    return result
  }

  async function removeTarget(targetId: string): Promise<void> {
    const commands = api().commands
    targets.value = (await api().invoke(commands.TARGETS_REMOVE, targetId)) as InterceptorTarget[]
  }

  /**
   * 更新条目开关，返回后端实际是否落到目标值。
   * 返回 false 通常意味着后端是旧进程（不认识该字段，补丁被丢弃），调用方要明确提示重启而不是静默失败。
   */
  async function updateTarget(targetId: string, patch: InterceptorTargetPatch): Promise<boolean> {
    const commands = api().commands
    const next = (await api().invoke(commands.TARGETS_TOGGLE, targetId, patch)) as InterceptorTarget[]
    targets.value = next
    const updated = next.find(target => target.id === targetId)
    if (!updated) return false
    const enabledOk = patch.enabled === undefined || (updated.enabled !== false) === patch.enabled
    const noCacheOk = patch.noCache === undefined || (updated.noCache !== false) === patch.noCache
    return enabledOk && noCacheOk
  }

  async function upsertRule(rule: InterceptorRule): Promise<void> {
    const commands = api().commands
    rules.value = (await api().invoke(commands.RULES_UPSERT, rule)) as InterceptorRule[]
  }

  async function deleteRule(ruleId: string): Promise<void> {
    const commands = api().commands
    rules.value = (await api().invoke(commands.RULES_DELETE, ruleId)) as InterceptorRule[]
  }

  async function clearTraffic(): Promise<void> {
    const commands = api().commands
    await api().invoke(commands.TRAFFIC_CLEAR)
    traffic.value = []
  }

  async function setProxyDesired(enabled: boolean): Promise<boolean> {
    const commands = api().commands
    return (await api().invoke(commands.PROXY_SET_DESIRED, enabled)) as boolean
  }

  async function setProxyPort(port: number): Promise<ProxyPortUpdateResult> {
    const commands = api().commands
    const result = (await api().invoke(commands.PROXY_PORT_SET, port)) as ProxyPortUpdateResult
    if (result.status) status.value = result.status
    return result
  }

  async function openExtensionDir(): Promise<boolean> {
    const commands = api().commands
    return (await api().invoke(commands.EXTENSION_OPEN_DIR)) as boolean
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
    updateTarget,
    upsertRule,
    deleteRule,
    clearTraffic,
    setProxyDesired,
    setProxyPort,
    openExtensionDir,
    openRuleEditorFromTraffic,
  }
})
