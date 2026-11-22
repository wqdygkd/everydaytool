import type {
  PikpakGetAccount,
  PikpakGetConnectionInput,
  PikpakGetConnectionView,
  PikpakGetEngineInfo,
  PikpakGetExport,
  PikpakGetLink,
  PikpakGetNodeSortKey,
  PikpakGetParseResult,
  PikpakGetTask,
  PikpakGetTaskInput,
  PikpakGetWhoami,
} from '../../../../shared/pikpak-get'
import { defineStore } from 'pinia'
import { flattenPikpakNodes } from '../../../../shared/pikpak-get'
import { invokePikpakGetIpc, pikpakGetIpcChannels } from '../ipc'
import { toIpcPayload } from '../ipc-payload'
import { pollDelayMs } from '../poll-policy'

export const usePikpakGetStore = defineStore('pikpakGet/state', () => {
  const connection = ref<PikpakGetConnectionView | null>(null)
  const engineInfo = ref<PikpakGetEngineInfo | null>(null)
  const accounts = ref<PikpakGetAccount[]>([])
  const whoami = ref<Record<string, PikpakGetWhoami>>({})
  const links = ref<PikpakGetLink[]>([])
  const tasks = ref<PikpakGetTask[]>([])
  const parse = ref<PikpakGetParseResult | null>(null)
  const parsingLinkId = ref<string | null>(null)
  const selectedFileIds = ref<string[]>([])
  const selectedLinkId = ref<string | null>(null)
  const sortKey = ref<PikpakGetNodeSortKey>('default')
  /** 大小默认「大到小」，名 / 后缀默认升序 */
  const sortDesc = ref(false)
  const loading = ref(false)
  const error = ref('')
  /** 最近一次成功拉取任务的时间（ms）；null = 还没成功过 */
  const lastRefreshedAt = ref<number | null>(null)
  /** 最近一次拉取失败的说明；非空表示队列数字已过期 */
  const refreshError = ref('')
  /** 右侧任务面板是否打开（决定轮询节奏） */
  const panelOpen = ref(false)
  /** 轮询是否启用（有连接时才开） */
  const polling = ref(false)
  let pollTimer: ReturnType<typeof setTimeout> | null = null

  const activeTasks = computed(() => tasks.value.filter(task =>
    task.status === 'queued' || task.status === 'running' || task.status === 'cancelling',
  ))

  const queuedTasks = computed(() => tasks.value.filter(task => task.status === 'queued'))
  /** 排队中还剩多少：任务数 / 计划文件数 / 计划体积（引擎入队时算好回传） */
  const queueSummary = computed(() => ({
    tasks: queuedTasks.value.length,
    files: queuedTasks.value.reduce((sum, task) => sum + (task.plannedFiles ?? 0), 0),
    bytes: queuedTasks.value.reduce((sum, task) => sum + (task.plannedBytes ?? 0), 0),
  }))

  const fileNodes = computed(() => (parse.value?.nodes ?? []).filter(node => !node.isFolder))
  const selectedCount = computed(() => selectedFileIds.value.length)
  const selectedBytes = computed(() => fileNodes.value
    .filter(node => selectedFileIds.value.includes(node.id))
    .reduce((sum, node) => sum + node.size, 0))

  /** 解析结果的展示顺序（深度优先 + 当前排序），下载排队也用它 */
  const orderedNodes = computed(() => flattenPikpakNodes(parse.value?.nodes ?? [], sortKey.value, sortDesc.value))
  const orderedFileIds = computed(() => orderedNodes.value.filter(node => !node.isFolder).map(node => node.id))
  /** 已勾选文件的下载顺序：界面看到什么次序，就按什么次序下 */
  const selectedDownloadOrder = computed(() => orderedFileIds.value.filter(id => selectedFileIds.value.includes(id)))

  function setSortKey(key: PikpakGetNodeSortKey): void {
    sortKey.value = key
    sortDesc.value = key === 'size'
  }

  function toggleSortDesc(): void {
    sortDesc.value = !sortDesc.value
  }

  function channels(): Record<string, string> {
    return pikpakGetIpcChannels()
  }

  function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    // 统一在边界拍平：调用方可能直接传响应式数组（如 selectedFileIds），
    // Proxy 过不了结构化克隆，会在 IPC 层抛「An object could not be cloned.」
    return invokePikpakGetIpc<T>(channel, ...args.map(toIpcPayload))
  }

  function fail(cause: unknown): never {
    error.value = cause instanceof Error ? cause.message : String(cause)
    throw cause
  }

  async function init(): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      connection.value = await invoke<PikpakGetConnectionView | null>(channels().CONNECTION_GET)
      if (connection.value) {
        await Promise.all([refreshAccounts(), refreshLinks(), refreshTasks()])
        void testConnection()
        startPolling()
      }
    } catch (cause) {
      fail(cause)
    } finally {
      loading.value = false
    }
  }

  function dispose(): void {
    stopPolling()
  }

  async function saveConnection(input: PikpakGetConnectionInput): Promise<void> {
    connection.value = await invoke<PikpakGetConnectionView>(channels().CONNECTION_SET, input)
    if (connection.value) startPolling()
  }

  async function testConnection(): Promise<PikpakGetEngineInfo | null> {
    try {
      engineInfo.value = await invoke<PikpakGetEngineInfo>(channels().CONNECTION_TEST)
      return engineInfo.value
    } catch (cause) {
      engineInfo.value = null
      throw cause
    }
  }

  // ---- 账号池 ----
  async function refreshAccounts(): Promise<void> {
    accounts.value = await invoke<PikpakGetAccount[]>(channels().ACCOUNTS_LIST)
  }

  async function login(label: string, password: string): Promise<void> {
    await invoke(channels().ACCOUNTS_LOGIN, label, password)
    await refreshAccounts()
  }

  async function logout(accountId: string): Promise<void> {
    await invoke(channels().ACCOUNTS_LOGOUT, accountId)
    await refreshAccounts()
  }

  async function refreshAccount(accountId: string): Promise<void> {
    await invoke(channels().ACCOUNTS_REFRESH, accountId)
    await refreshAccounts()
  }

  async function revealPassword(accountId: string): Promise<string> {
    const result = await invoke<{ password: string }>(channels().ACCOUNTS_REVEAL_PASSWORD, accountId)
    return result.password
  }

  async function fetchWhoami(accountId: string): Promise<PikpakGetWhoami> {
    const result = await invoke<PikpakGetWhoami>(channels().ACCOUNTS_WHOAMI, accountId)
    whoami.value[accountId] = result
    return result
  }

  // ---- 分享链接 ----
  async function refreshLinks(): Promise<void> {
    links.value = await invoke<PikpakGetLink[]>(channels().LINKS_LIST)
  }

  async function addLink(url: string, folder?: string, passCode?: string): Promise<void> {
    await invoke(channels().LINKS_ADD, url, folder, passCode)
    await refreshLinks()
  }

  async function updateLink(linkId: string, patch: { title?: string, folder?: string, passCode?: string, url?: string }): Promise<void> {
    await invoke(channels().LINKS_UPDATE, linkId, patch)
    if (patch.url && parse.value?.linkId === linkId) parse.value = null
    await refreshLinks()
  }

  async function deleteLink(linkId: string): Promise<void> {
    await invoke(channels().LINKS_DELETE, linkId)
    if (parse.value?.linkId === linkId) parse.value = null
    if (selectedLinkId.value === linkId) selectedLinkId.value = null
    selectedFileIds.value = []
    await refreshLinks()
  }

  async function parseLink(linkId: string, force = false): Promise<void> {
    parsingLinkId.value = linkId
    selectedLinkId.value = linkId
    error.value = ''
    try {
      const result = await invoke<PikpakGetParseResult>(channels().LINKS_PARSE, linkId, force)
      // 解析结果缺 linkId（引擎契约漂移 / 旧版 NAS 镜像）时回填请求用的 id，
      // 否则后续「重新解析 / 删除记录 / 下载选中」会拿 undefined 撞主进程的 ID 校验。
      parse.value = { ...result, linkId: result.linkId || linkId }
      selectedFileIds.value = []
    } catch (cause) {
      fail(cause)
    } finally {
      parsingLinkId.value = null
    }
  }

  async function selectLink(linkId: string, force = false): Promise<void> {
    selectedLinkId.value = linkId
    await parseLink(linkId, force)
  }

  function toggleFile(nodeId: string): void {
    const index = selectedFileIds.value.indexOf(nodeId)
    if (index >= 0) selectedFileIds.value = selectedFileIds.value.filter(item => item !== nodeId)
    else selectedFileIds.value = [...selectedFileIds.value, nodeId]
  }

  function selectAllFiles(): void {
    selectedFileIds.value = fileNodes.value.map(node => node.id)
  }

  function clearSelection(): void {
    selectedFileIds.value = []
  }

  /** 批量勾选/取消一组文件（文件夹勾选用） */
  function toggleFiles(ids: string[]): void {
    const allSelected = ids.length > 0 && ids.every(id => selectedFileIds.value.includes(id))
    if (allSelected) {
      selectedFileIds.value = selectedFileIds.value.filter(id => !ids.includes(id))
    } else {
      selectedFileIds.value = [...new Set([...selectedFileIds.value, ...ids])]
    }
  }

  /** 删除已下载记录（重置为未下载），返回删除条数 */
  async function resetRecords(linkId: string, fileIds: string[]): Promise<number> {
    const result = await invoke<{ reset: number }>(channels().LINKS_RESET_RECORDS, linkId, fileIds)
    return result.reset
  }

  // ---- 数据导入导出 ----
  async function exportData(): Promise<PikpakGetExport> {
    return invoke<PikpakGetExport>(channels().DATA_EXPORT)
  }

  async function importData(payload: PikpakGetExport): Promise<number> {
    const result = await invoke<{ imported: number }>(channels().DATA_IMPORT, payload)
    await refreshAccounts()
    await refreshLinks()
    return result.imported
  }

  // ---- 下载任务 ----
  async function refreshTasks(): Promise<void> {
    try {
      tasks.value = await invoke<PikpakGetTask[]>(channels().TASKS_LIST)
      lastRefreshedAt.value = Date.now()
      refreshError.value = ''
    } catch (cause) {
      // 保留上一次的数据，只标记「已过期」——直接清空会让界面像任务全没了
      refreshError.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    } finally {
      scheduleNextPoll()
    }
  }

  async function startDownload(input: PikpakGetTaskInput): Promise<PikpakGetTask> {
    const task = await invoke<PikpakGetTask>(channels().TASKS_START, input)
    // 任务已提交成功；刷新失败不该让调用方以为提交失败
    await refreshTasks().catch(() => undefined)
    return task
  }

  /** 下载当前勾选（按展示顺序）；没有可下的返回 null，由调用方决定提示文案 */
  async function downloadSelected(): Promise<PikpakGetTask | null> {
    const current = parse.value
    if (!current || !selectedFileIds.value.length) return null
    return startDownload({ linkId: current.linkId, fileIds: selectedDownloadOrder.value })
  }

  async function cancelTask(taskId: string): Promise<void> {
    await invoke(channels().TASKS_CANCEL, taskId)
    await refreshTasks().catch(() => undefined)
  }

  /** 任务面板开合时切换轮询节奏（打开时 1s，收起后按任务状态回落） */
  function setPanelOpen(open: boolean): void {
    if (panelOpen.value === open) return
    panelOpen.value = open
    scheduleNextPoll()
  }

  function scheduleNextPoll(): void {
    if (pollTimer) clearTimeout(pollTimer)
    if (!polling.value) return
    const delay = pollDelayMs({
      panelOpen: panelOpen.value,
      activeTasks: activeTasks.value.length,
      knownTasks: tasks.value.length,
    })
    pollTimer = setTimeout(() => {
      pollTimer = null
      void refreshTasks().catch(() => undefined)
    }, delay)
  }

  function startPolling(): void {
    polling.value = true
    scheduleNextPoll()
  }

  function stopPolling(): void {
    polling.value = false
    if (pollTimer) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  return {
    connection,
    engineInfo,
    accounts,
    whoami,
    links,
    tasks,
    parse,
    parsingLinkId,
    selectedFileIds,
    selectedLinkId,
    sortKey,
    sortDesc,
    loading,
    error,
    activeTasks,
    queueSummary,
    lastRefreshedAt,
    refreshError,
    setPanelOpen,
    fileNodes,
    selectedCount,
    selectedBytes,
    selectedDownloadOrder,
    setSortKey,
    toggleSortDesc,
    init,
    dispose,
    saveConnection,
    testConnection,
    refreshAccounts,
    login,
    logout,
    refreshAccount,
    revealPassword,
    fetchWhoami,
    refreshLinks,
    addLink,
    updateLink,
    deleteLink,
    parseLink,
    selectLink,
    toggleFile,
    selectAllFiles,
    clearSelection,
    toggleFiles,
    resetRecords,
    exportData,
    importData,
    refreshTasks,
    startDownload,
    downloadSelected,
    cancelTask,
  }
})
