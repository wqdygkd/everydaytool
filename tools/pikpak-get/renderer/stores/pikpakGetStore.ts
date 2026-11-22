import type {
  PikpakGetAccount,
  PikpakGetConnectionInput,
  PikpakGetConnectionView,
  PikpakGetEngineInfo,
  PikpakGetExport,
  PikpakGetLink,
  PikpakGetParseResult,
  PikpakGetTask,
  PikpakGetTaskInput,
  PikpakGetWhoami,
} from '../../../../shared/pikpak-get'
import { defineStore } from 'pinia'
import { invokePikpakGetIpc, pikpakGetIpcChannels } from '../ipc'
import { toIpcPayload } from '../ipc-payload'

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
  const loading = ref(false)
  const error = ref('')
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const activeTasks = computed(() => tasks.value.filter(task =>
    task.status === 'queued' || task.status === 'running' || task.status === 'cancelling',
  ))

  const fileNodes = computed(() => (parse.value?.nodes ?? []).filter(node => !node.isFolder))
  const selectedCount = computed(() => selectedFileIds.value.length)
  const selectedBytes = computed(() => fileNodes.value
    .filter(node => selectedFileIds.value.includes(node.id))
    .reduce((sum, node) => sum + node.size, 0))

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
    tasks.value = await invoke<PikpakGetTask[]>(channels().TASKS_LIST)
  }

  async function startDownload(input: PikpakGetTaskInput): Promise<PikpakGetTask> {
    const task = await invoke<PikpakGetTask>(channels().TASKS_START, input)
    await refreshTasks()
    return task
  }

  async function cancelTask(taskId: string): Promise<void> {
    await invoke(channels().TASKS_CANCEL, taskId)
    await refreshTasks()
  }

  function startPolling(): void {
    if (pollTimer) return
    pollTimer = setInterval(() => {
      void refreshTasks().catch(() => undefined)
    }, 1500)
  }

  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer)
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
    loading,
    error,
    activeTasks,
    fileNodes,
    selectedCount,
    selectedBytes,
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
    cancelTask,
  }
})
