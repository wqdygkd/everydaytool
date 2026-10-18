import type {
  OfflinePackDockerDownloadRequest,
  OfflinePackDownloadProgress,
  OfflinePackDownloadRequest,
  OfflinePackDownloadResult,
  OfflinePackSimpleDownloadRequest,
} from '@shared/offline-pack'
import { ElMessage } from 'element-plus'
import { onUnmounted, ref } from 'vue'
import { getOfflinePackApi } from '../ipc'

export type OfflinePackDownloadInput
  = | Omit<OfflinePackSimpleDownloadRequest, 'taskId'>
    | Omit<OfflinePackDockerDownloadRequest, 'taskId'>

/** 共享下载编排：生成 taskId、订阅进度、执行下载、管理结果与取消 */
export function useOfflinePackDownload() {
  const progress = ref<OfflinePackDownloadProgress | null>(null)
  const downloading = ref(false)
  const result = ref<OfflinePackDownloadResult | null>(null)
  const taskId = ref('')
  let offProgress: (() => void) | null = null

  function subscribe(): void {
    if (offProgress) return
    const api = getOfflinePackApi()
    if (!api) return
    offProgress = api.on(api.channels.EVENT_PROGRESS, (payload) => {
      const p = payload as OfflinePackDownloadProgress
      if (!taskId.value || p.taskId !== taskId.value) return
      progress.value = p
      if (p.status === 'completed' || p.status === 'error' || p.status === 'cancelled') {
        downloading.value = false
      }
    })
  }

  async function start(request: OfflinePackDownloadInput): Promise<boolean> {
    const api = getOfflinePackApi()
    if (!api) {
      ElMessage.warning('离线包下载 仅在 Electron 桌面端可用')
      return false
    }
    subscribe()
    const id = crypto.randomUUID()
    taskId.value = id
    progress.value = null
    result.value = null
    downloading.value = true
    try {
      const res = await api.invoke(api.channels.DOWNLOAD, { ...request, taskId: id } as OfflinePackDownloadRequest)
      result.value = res as OfflinePackDownloadResult
      return true
    } catch (error) {
      ElMessage.error((error as Error).message || '下载失败')
      return false
    } finally {
      downloading.value = false
    }
  }

  async function cancel(): Promise<void> {
    const api = getOfflinePackApi()
    if (!api || !taskId.value) return
    await api.invoke(api.channels.CANCEL_DOWNLOAD, taskId.value)
  }

  async function openDir(): Promise<void> {
    const api = getOfflinePackApi()
    if (!api) return
    try {
      await api.invoke(api.channels.OPEN_DIR)
    } catch (error) {
      ElMessage.error((error as Error).message || '打开目录失败')
    }
  }

  onUnmounted(() => {
    offProgress?.()
    offProgress = null
  })

  return { progress, downloading, result, start, cancel, openDir }
}
