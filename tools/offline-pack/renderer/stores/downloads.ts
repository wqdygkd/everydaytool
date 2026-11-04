import type {
  OfflinePackDockerDownloadRequest,
  OfflinePackDownloadKind,
  OfflinePackDownloadProgress,
  OfflinePackDownloadResult,
  OfflinePackSimpleDownloadRequest,
} from '@shared/offline-pack'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { getOfflinePackApi } from '../ipc'

export type OfflinePackTaskStatus = 'running' | 'completed' | 'error' | 'cancelled'

/** 下载任务输入：taskId 由 store 统一生成 */
export type OfflinePackDownloadInput
  = | Omit<OfflinePackSimpleDownloadRequest, 'taskId'>
    | Omit<OfflinePackDockerDownloadRequest, 'taskId'>

export interface OfflinePackTask {
  taskId: string
  kind: OfflinePackDownloadKind
  /** 任务展示名：镜像名 / 文件名 */
  title: string
  progress: OfflinePackDownloadProgress | null
  status: OfflinePackTaskStatus
  result: OfflinePackDownloadResult | null
  error: string
  startedAt: number
}

/** 已结束任务最多保留几条，避免任务区无限增长（历史里有完整记录） */
const MAX_FINISHED_TASKS = 5

/** 单任务进度百分比；docker 是按层的字节数，跨层不累计 */
export function taskPercentage(task: OfflinePackTask | null | undefined): number {
  const progress = task?.progress
  if (!progress || progress.totalBytes <= 0) return 0
  return Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100))
}

export const useOfflinePackDownloadsStore = defineStore('offlinePack/downloads', () => {
  const tasks = ref<OfflinePackTask[]>([])

  const activeTasks = computed(() => tasks.value.filter(task => task.status === 'running'))
  const activeCount = computed(() => activeTasks.value.length)
  /** 左栏入口只展示一个数字：优先最新的进行中任务 */
  const activePercent = computed(() => taskPercentage(activeTasks.value[0]))
  const finishedCount = computed(() => tasks.value.length - activeTasks.value.length)

  let offProgress: (() => void) | null = null

  function client() {
    return getOfflinePackApi()
  }

  /** 事件监听只注册一次：任务状态集中在 store，换镜像 / 切来源都不影响 */
  function ensureListener(): void {
    if (offProgress) return
    const api = client()
    if (!api) return
    offProgress = api.on(api.channels.EVENT_PROGRESS, (payload) => {
      applyProgress(payload as OfflinePackDownloadProgress)
    })
  }

  function applyProgress(progress: OfflinePackDownloadProgress): void {
    const task = tasks.value.find(item => item.taskId === progress.taskId)
    if (!task) return
    task.progress = progress

    if (progress.status === 'completed') {
      if (task.status !== 'completed') {
        task.status = 'completed'
        task.error = ''
        toast.success(`下载完成：${task.title}`)
        pruneFinished()
      }
      return
    }

    if (progress.status === 'error') {
      task.status = 'error'
      task.error = progress.error || '下载失败'
      toast.error(task.error)
      return
    }

    if (progress.status === 'cancelled') {
      task.status = 'cancelled'
      task.error = ''
      return
    }

    task.status = 'running'
  }

  function pruneFinished(): void {
    const finished = tasks.value.filter(task => task.status !== 'running')
    for (const task of finished.slice(MAX_FINISHED_TASKS)) {
      tasks.value = tasks.value.filter(item => item.taskId !== task.taskId)
    }
  }

  async function start(request: OfflinePackDownloadInput, title?: string): Promise<OfflinePackDownloadResult | null> {
    const api = client()
    if (!api) {
      toast.warning('离线包下载 仅在 Electron 桌面端可用')
      return null
    }
    ensureListener()

    const taskId = crypto.randomUUID()
    tasks.value.unshift({
      taskId,
      kind: request.kind,
      title: title?.trim() || request.filename,
      progress: null,
      status: 'running',
      result: null,
      error: '',
      startedAt: Date.now(),
    })

    try {
      const result = await api.invoke(api.channels.DOWNLOAD, { ...request, taskId }) as OfflinePackDownloadResult
      const task = tasks.value.find(item => item.taskId === taskId)
      if (task) {
        task.result = result
        // 完成事件可能先到；只有还停在 running 时才补终态与提示
        if (task.status === 'running') {
          task.status = 'completed'
          toast.success(`下载完成：${task.title}`)
        }
      }
      return result
    } catch (error) {
      const task = tasks.value.find(item => item.taskId === taskId)
      if (task && task.status === 'running') {
        const message = (error as Error).message || '下载失败'
        if (/abort|cancel/i.test(message)) {
          // 取消事件还没到时先按取消处理，避免把主动取消报成失败
          task.status = 'cancelled'
          task.error = ''
        } else {
          // 后端已经通过 error 事件报过的，不再重复 toast
          task.status = 'error'
          task.error = message
          toast.error(task.error)
        }
      }
      return null
    }
  }

  async function cancel(taskId: string): Promise<void> {
    const api = client()
    if (!api) return
    try {
      await api.invoke(api.channels.CANCEL_DOWNLOAD, taskId)
    } catch (error) {
      toast.error((error as Error).message || '取消失败')
    }
  }

  async function cancelAll(): Promise<void> {
    const api = client()
    if (!api) return
    await Promise.all(activeTasks.value.map(task =>
      api.invoke(api.channels.CANCEL_DOWNLOAD, task.taskId).catch(() => undefined),
    ))
  }

  async function openDir(): Promise<void> {
    const api = client()
    if (!api) return
    try {
      await api.invoke(api.channels.OPEN_DIR)
    } catch (error) {
      toast.error((error as Error).message || '打开目录失败')
    }
  }

  function dismiss(taskId: string): void {
    tasks.value = tasks.value.filter(task => task.taskId !== taskId)
  }

  function clearFinished(): void {
    tasks.value = tasks.value.filter(task => task.status === 'running')
  }

  /** 关闭工具时清空会话：取消未完成任务，避免后台继续写盘 */
  async function reset(): Promise<void> {
    const running = activeTasks.value.map(task => task.taskId)
    tasks.value = []
    await Promise.all(running.map(taskId => cancel(taskId)))
  }

  return {
    tasks,
    activeTasks,
    activeCount,
    activePercent,
    finishedCount,
    start,
    cancel,
    cancelAll,
    openDir,
    dismiss,
    clearFinished,
    reset,
  }
})
