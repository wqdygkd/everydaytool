import { Buffer } from 'node:buffer'
import { createWriteStream } from 'node:fs'
import { net } from 'electron'
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

export async function downloadToFile(
  url: string,
  destPath: string,
  options: { signal?: AbortSignal, onProgress?: DownloadProgress } = {},
): Promise<void> {
  const res = await request(url, { signal: options.signal }, DEFAULT_TIMEOUT_MS)
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
  if (!res.body) throw new Error('上游未返回文件流')
  const total = Number(res.headers.get('content-length') ?? 0)
  const writer = createWriteStream(destPath)
  const reader = res.body.getReader()
  let downloaded = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!writer.write(Buffer.from(value))) {
        await new Promise<void>(resolve => writer.once('drain', () => resolve()))
      }
      downloaded += value.length
      options.onProgress?.(downloaded, total)
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      writer.end((err?: Error | null) => (err ? reject(err) : resolve()))
    })
  }
}
