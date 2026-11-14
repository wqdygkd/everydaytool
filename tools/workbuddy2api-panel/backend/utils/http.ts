import { rename, rm } from 'node:fs/promises'
import { net } from 'electron'
import { downloadToFile as downloadFile } from '../../../../backend/utils/http-download.ts'
import { isAllowedWb2apiDownloadUrl } from '../../../../shared/workbuddy2api-panel.ts'

const DEFAULT_TIMEOUT_MS = 120_000
const UA = 'everydaytool-workbuddy2api-panel/1.0'

export interface DownloadProgress {
  (downloaded: number, total: number): void
}

function assertAllowedUrl(url: string): void {
  if (!isAllowedWb2apiDownloadUrl(url)) {
    throw new Error(`拒绝非白名单下载地址：${url}`)
  }
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  assertAllowedUrl(url)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const external = init.signal
  const onAbort = (): void => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onAbort)
  }
  try {
    return await net.fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, ...(init.headers as Record<string, string> | undefined) },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
    if (external) external.removeEventListener('abort', onAbort)
  }
}

export async function fetchGithubJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await request(url, { signal }, DEFAULT_TIMEOUT_MS)
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  return (await res.json()) as T
}

/**
 * 下载到文件。先写 `<dest>.part`，完整落盘后才 rename 成目标名：
 * - 取消 / 失败时把半成品删掉，downloads/ 里不会留下看起来像「已下载」的残缺 zip；
 * - 目标名只会在成功那一刻出现，调用方不会误用未完成的文件。
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  options: { signal?: AbortSignal, onProgress?: DownloadProgress } = {},
): Promise<void> {
  const tempPath = `${destPath}.part`
  try {
    assertAllowedUrl(url)
    await downloadFile(url, tempPath, {
      headers: { 'User-Agent': UA },
      signal: options.signal,
      idleTimeoutMs: DEFAULT_TIMEOUT_MS,
      onProgress: options.onProgress,
    })
    await rename(tempPath, destPath)
  }
  catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}
