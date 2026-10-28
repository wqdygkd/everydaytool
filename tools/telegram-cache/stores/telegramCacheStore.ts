// telegram-cache 渲染层状态：主进程快照 + 增量事件（快照 700ms 节流；每个请求一条 traffic；
// 任务状态逐次推送）。所有失败都向上抛，由面板决定如何提示（与 interceptor / offline-pack 一致）。
import type {
  TelegramArchiveEntry,
  TelegramBenchmarkStatus,
  TelegramCacheConfig,
  TelegramDiagnosticsExport,
  TelegramFeasibilityReport,
  TelegramMtprotoStatus,
  TelegramPageProbe,
  TelegramResourceKind,
  TelegramSelfTestResult,
  TelegramSnapshot,
  TelegramTaskSnapshot,
  TelegramTrafficEntry,
} from '@shared/telegram-cache'
import { TELEGRAM_TRAFFIC_LIMIT } from '@shared/telegram-cache'
import { defineStore } from 'pinia'
import { getTelegramApi } from '../api'

export interface AcquireOutcome {
  reused: boolean
  joined: boolean
  archiveRelativePath?: string
  taskId?: string
  record: {
    resourceKey: string
    displayUrl: string
    size: number
    sha256: string
    relativePath: string
    mimeType: string
    verification: string
  }
}

export const useTelegramCacheStore = defineStore('telegramCache/state', () => {
  const snapshot = ref<TelegramSnapshot | null>(null)
  const traffic = ref<TelegramTrafficEntry[]>([])
  const tasks = ref<TelegramTaskSnapshot[]>([])
  const archives = ref<TelegramArchiveEntry[]>([])
  const probe = ref<TelegramPageProbe | null>(null)
  const selfTest = ref<TelegramSelfTestResult | null>(null)
  const m3Report = ref<TelegramFeasibilityReport | null>(null)
  const mtproto = ref<TelegramMtprotoStatus | null>(null)
  const benchmark = ref<TelegramBenchmarkStatus | null>(null)
  const diagnostics = ref<TelegramDiagnosticsExport | null>(null)
  const pageWebContentsId = ref<string | null>(null)
  const ready = ref(false)
  const busy = reactive({ probe: false, selfTest: false, diagnostics: false, archives: false, cache: false, m3: false })

  const config = computed<TelegramCacheConfig | null>(() => snapshot.value?.config ?? null)
  const observationEnabled = computed(() => snapshot.value?.config.observationEnabled === true)
  const capabilities = computed(() => snapshot.value?.capabilities ?? null)
  const stats = computed(() => snapshot.value?.stats ?? null)
  const cache = computed(() => snapshot.value?.cache ?? null)
  const resources = computed(() => snapshot.value?.resources ?? [])
  const activeTasks = computed(() => tasks.value.filter(task => task.status === 'queued' || task.status === 'running'))
  const archiveCount = computed(() => snapshot.value?.archiveCount ?? archives.value.length)

  let disposers: Array<() => void> = []
  let initialized = false

  function channels(): Record<string, string> {
    const api = getTelegramApi()
    if (!api) throw new Error('Telegram 网络优化仅在桌面端可用')
    return api.commands
  }

  /** 命令调用：本项目 api 是 (command, ...args) 形态 */
  function invoke<T>(command: string, ...args: unknown[]): Promise<T> {
    const api = getTelegramApi()
    if (!api) return Promise.reject(new Error('Telegram 网络优化仅在桌面端可用'))
    return api.invoke(command, ...args) as Promise<T>
  }

  function onEvent(channel: string, handler: (payload: unknown) => void): () => void {
    const api = getTelegramApi()
    if (!api) return () => {}
    return api.on(channel, handler)
  }

  function applySnapshot(next: TelegramSnapshot): void {
    snapshot.value = next
    tasks.value = [...next.tasks]
  }

  function applyTask(next: TelegramTaskSnapshot): void {
    const index = tasks.value.findIndex(task => task.taskId === next.taskId)
    if (index >= 0) tasks.value[index] = next
    else tasks.value.unshift(next)
    tasks.value.sort((a, b) => {
      const rank = (task: TelegramTaskSnapshot): number => (task.status === 'queued' || task.status === 'running' ? 0 : 1)
      return rank(a) - rank(b) || (b.finishedAt ?? b.queuedAt) - (a.finishedAt ?? a.queuedAt)
    })
    if (tasks.value.length > 80) tasks.value = tasks.value.slice(0, 80)
  }

  async function init(): Promise<void> {
    if (initialized) return
    initialized = true
    const ch = channels()

    disposers.push(onEvent(ch.EVENT_SNAPSHOT, (payload) => {
      applySnapshot(payload as TelegramSnapshot)
    }))
    disposers.push(onEvent(ch.EVENT_TRAFFIC, (payload) => {
      traffic.value.push(payload as TelegramTrafficEntry)
      if (traffic.value.length > TELEGRAM_TRAFFIC_LIMIT) {
        traffic.value.splice(0, traffic.value.length - TELEGRAM_TRAFFIC_LIMIT)
      }
    }))
    disposers.push(onEvent(ch.EVENT_TASK, (payload) => {
      applyTask(payload as TelegramTaskSnapshot)
    }))
    disposers.push(onEvent(ch.EVENT_MTPROTO, (payload) => {
      mtproto.value = payload as TelegramMtprotoStatus
    }))
    disposers.push(onEvent(ch.EVENT_BENCHMARK, (payload) => {
      benchmark.value = payload as TelegramBenchmarkStatus
    }))

    const [initialSnapshot, initialTraffic, initialArchives, initialMtproto, initialBenchmark] = await Promise.all([
      invoke<TelegramSnapshot>(ch.SNAPSHOT_GET),
      invoke<TelegramTrafficEntry[]>(ch.TRAFFIC_GET),
      invoke<TelegramArchiveEntry[]>(ch.ARCHIVE_LIST),
      invoke<TelegramMtprotoStatus>(ch.MT_STATUS),
      invoke<TelegramBenchmarkStatus>(ch.BENCHMARK_STATUS),
    ])
    applySnapshot(initialSnapshot)
    traffic.value = initialTraffic
    archives.value = initialArchives
    mtproto.value = initialMtproto
    benchmark.value = initialBenchmark
    ready.value = true
  }

  function dispose(): void {
    for (const off of disposers) off()
    disposers = []
    initialized = false
    ready.value = false
  }

  async function setObservationEnabled(enabled: boolean): Promise<void> {
    applySnapshot(await invoke<TelegramSnapshot>(channels().OBSERVATION_SET_ENABLED, enabled))
  }

  async function updateConfig(patch: Partial<TelegramCacheConfig>): Promise<void> {
    const result = await invoke<{ config: TelegramCacheConfig, snapshot: TelegramSnapshot }>(channels().CONFIG_SET, patch)
    applySnapshot(result.snapshot)
  }

  async function clearObservation(): Promise<void> {
    applySnapshot(await invoke<TelegramSnapshot>(channels().OBSERVATION_CLEAR))
    traffic.value = []
  }

  async function clearCache(): Promise<{ evictedBytes: number, evictions: number }> {
    busy.cache = true
    try {
      const result = await invoke<{ evictedBytes: number, evictions: number, snapshot: TelegramSnapshot }>(
        channels().CACHE_CLEAR,
      )
      applySnapshot(result.snapshot)
      return { evictedBytes: result.evictedBytes, evictions: result.evictions }
    } finally {
      busy.cache = false
    }
  }

  async function attachPage(webviewId: string): Promise<void> {
    pageWebContentsId.value = webviewId
    await invoke(channels().PAGE_ATTACH, webviewId)
  }

  /** 页面探测：先向桌面壳要脚本，在子 Webview 里执行，再把原始结果交回桌面壳解析 */
  async function probePage(runScript: (script: string) => Promise<unknown>): Promise<TelegramPageProbe> {
    if (!pageWebContentsId.value) throw new Error('页面尚未就绪')
    busy.probe = true
    try {
      const plan = await invoke<{ script: string, webviewId: string | null }>(channels().PAGE_PROBE)
      const raw = await runScript(plan.script)
      const result = await invoke<TelegramPageProbe>(channels().PAGE_PROBE, raw)
      probe.value = result
      return result
    } finally {
      busy.probe = false
    }
  }

  /** 观测：轮询取采集脚本 → 在子 Webview 执行 → 把新增条目按条上报 */
  async function reportObservations(
    runScript: (script: string) => Promise<unknown>,
    since: () => number,
    setCursor: (cursor: number) => void,
  ): Promise<void> {
    if (!pageWebContentsId.value) return
    const plan = await invoke<{ script: string }>(channels().OBSERVATION_SCRIPT, since())
    const result = await runScript(plan.script) as {
      ok?: boolean
      entries?: Record<string, unknown>[]
      cursor?: number
    } | null
    if (!result?.ok) return
    for (const entry of result.entries ?? []) {
      await invoke(channels().OBSERVATION_REPORT, entry).catch(() => {})
    }
    if (typeof result.cursor === 'number') setCursor(result.cursor)
  }

  async function acquire(resourceKey: string, kind: TelegramResourceKind): Promise<AcquireOutcome> {
    return invoke<AcquireOutcome>(channels().ACQUIRE, resourceKey, kind)
  }

  async function cancelTask(taskId: string): Promise<boolean> {
    return invoke<boolean>(channels().TASK_CANCEL, taskId)
  }

  async function loadArchives(): Promise<void> {
    busy.archives = true
    try {
      archives.value = await invoke<TelegramArchiveEntry[]>(channels().ARCHIVE_LIST)
    } finally {
      busy.archives = false
    }
  }

  async function openArchiveDir(): Promise<void> {
    await invoke(channels().ARCHIVE_OPEN_DIR)
  }

  async function openDataDir(): Promise<void> {
    await invoke(channels().OPEN_DATA_DIR)
  }

  async function runSelfTest(): Promise<TelegramSelfTestResult> {
    busy.selfTest = true
    try {
      const result = await invoke<TelegramSelfTestResult>(channels().SELF_TEST)
      selfTest.value = result
      return result
    } finally {
      busy.selfTest = false
    }
  }

  async function runFeasibilityReport(): Promise<TelegramFeasibilityReport> {
    busy.m3 = true
    try {
      const result = await invoke<TelegramFeasibilityReport>(channels().M3_REPORT)
      m3Report.value = result
      return result
    } finally {
      busy.m3 = false
    }
  }

  async function refreshMtprotoStatus(): Promise<void> {
    mtproto.value = await invoke<TelegramMtprotoStatus>(channels().MT_STATUS)
  }

  async function startMtprotoDownload(link: string): Promise<{ taskId: string | null }> {
    const result = await invoke<{ taskId: string | null }>(channels().MT_DOWNLOAD, link)
    await refreshMtprotoStatus()
    return result
  }

  async function cancelMtprotoDownload(): Promise<boolean> {
    return invoke<boolean>(channels().MT_CANCEL)
  }

  async function migrateMtprotoSession(): Promise<void> {
    mtproto.value = await invoke<TelegramMtprotoStatus>(channels().MT_SESSION_MIGRATE)
  }

  async function clearMtprotoSecureSession(): Promise<void> {
    mtproto.value = await invoke<TelegramMtprotoStatus>(channels().MT_SESSION_CLEAR)
  }

  async function startBenchmark(label: string): Promise<void> {
    benchmark.value = await invoke<TelegramBenchmarkStatus>(channels().BENCHMARK_START, label)
  }

  async function stopBenchmark(): Promise<void> {
    benchmark.value = await invoke<TelegramBenchmarkStatus>(channels().BENCHMARK_STOP)
  }

  async function clearBenchmarks(): Promise<void> {
    benchmark.value = await invoke<TelegramBenchmarkStatus>(channels().BENCHMARK_CLEAR)
  }

  async function exportDiagnostics(): Promise<TelegramDiagnosticsExport> {
    busy.diagnostics = true
    try {
      const result = await invoke<TelegramDiagnosticsExport>(channels().DIAGNOSTICS_EXPORT)
      diagnostics.value = result
      return result
    } finally {
      busy.diagnostics = false
    }
  }

  return {
    snapshot,
    traffic,
    tasks,
    archives,
    probe,
    selfTest,
    m3Report,
    mtproto,
    benchmark,
    diagnostics,
    pageWebContentsId,
    reportObservations,
    ready,
    busy,
    config,
    observationEnabled,
    capabilities,
    stats,
    cache,
    resources,
    activeTasks,
    archiveCount,
    init,
    dispose,
    setObservationEnabled,
    updateConfig,
    clearObservation,
    clearCache,
    attachPage,
    probePage,
    acquire,
    cancelTask,
    loadArchives,
    openArchiveDir,
    openDataDir,
    runSelfTest,
    runFeasibilityReport,
    refreshMtprotoStatus,
    startMtprotoDownload,
    cancelMtprotoDownload,
    migrateMtprotoSession,
    clearMtprotoSecureSession,
    startBenchmark,
    stopBenchmark,
    clearBenchmarks,
    exportDiagnostics,
  }
})
