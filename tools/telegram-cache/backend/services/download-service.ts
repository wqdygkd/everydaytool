// M1：把「观测到的可复用地址」下载成校验过的内容对象。
//
// 安全与正确性要点：
// - 下载地址只从主进程的观测表里取，渲染层只能传资源键（不能指定任意 URL）。
// - 先写 tmp/*.part，边写边算 SHA-256；完成后校验大小再原子 rename 到 objects/<前两位>/<sha256>。
// - 只有「完整写入 + 哈希」的条目才进索引；中断下载不会被当成完整文件。
// - 使用同一分区 session.fetch，登录态 / Cookie / 代理与页面一致，不额外转发任何请求头。
import type { TelegramResourceKind } from '../../../../shared/telegram-cache.ts'
import type { TelegramResourceRecord } from '../store/resource-registry.ts'
import type { CacheFreshness } from './http-semantics.ts'
import type { ObservedResource } from './observation-service.ts'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { TELEGRAM_TASK_MAX_ATTEMPTS } from '../../../../shared/telegram-cache.ts'
import { TELEGRAM_CACHE_IPC_CHANNELS } from '../ipc/channels.ts'
import { getTelegramCacheConfig } from '../store/config-store.ts'
import {
  getTelegramResourceRecord,
  isVerifiedCompleteRecord,
  recordTelegramContent,
  resolveTelegramObjectPath,
  touchTelegramResource,
} from '../store/resource-registry.ts'
import { getTelegramObjectsDir, getTelegramTmpDir, toTelegramRelativePath } from '../utils/paths.ts'
import { archiveTelegramResource } from './archive-service.ts'
import { enforceTelegramCacheQuota, setTelegramActiveCacheKeysProvider } from './cache-manager.ts'
import { evaluateResponseCaching } from './http-semantics.ts'
import { getObservedResource } from './observation-service.ts'
import { NonRetryableTaskError, SingleFlightTaskManager, TaskCancelledError } from './task-manager.ts'
import { getTelegramSession } from './telegram-session.ts'

export interface AcquireResult {
  record: TelegramResourceRecord
  /** true = 直接复用了资源库里已校验的内容（未发生任何下载） */
  reused: boolean
  /** true = 合并进了某个正在进行的任务 */
  joined: boolean
  /** 已归档副本的相对路径（仅 kind=archive 时有值） */
  archiveRelativePath?: string
  taskId?: string
}

let manager: SingleFlightTaskManager<TelegramResourceRecord> | null = null

function getManager(): SingleFlightTaskManager<TelegramResourceRecord> {
  if (manager) return manager
  manager = new SingleFlightTaskManager<TelegramResourceRecord>({
    maxConcurrent: getTelegramCacheConfig().maxHttpConcurrency,
    onChange: (snapshot) => {
      broadcastToWindows(TELEGRAM_CACHE_IPC_CHANNELS.EVENT_TASK, snapshot, {
        onError: error => logger.warn('Telegram task broadcast failed', { error: error.message }),
      })
    },
  })
  // 缓存淘汰要跳过正在下载 / 正在使用的资源键；这里注入实时读取，避免缓存管理器反向依赖任务管理器
  setTelegramActiveCacheKeysProvider(() => new Set(
    getManager().getSnapshots().filter(snapshot => snapshot.status === 'queued' || snapshot.status === 'running').map(snapshot => snapshot.resourceKey),
  ))
  return manager
}

/** 配置变更后同步并发上限（正在运行的任务不受影响，后续排队任务按新上限调度） */
export function refreshTelegramTaskConcurrency(): void {
  getManager().setMaxConcurrent(getTelegramCacheConfig().maxHttpConcurrency)
}

export function listTelegramTaskSnapshots() {
  return getManager().getSnapshots()
}

export function cancelTelegramTask(taskId: string): boolean {
  if (typeof taskId !== 'string' || !taskId) return false
  const active = getManager().getSnapshots().find(item => item.taskId === taskId)
  if (!active) return false
  return getManager().cancelTask(active.resourceKey)
}

export function disposeTelegramTasks(): void {
  manager?.cancelAll()
  manager = null
}

function objectPathForDigest(digest: string): string {
  return path.join(getTelegramObjectsDir(), digest.slice(0, 2), digest)
}

function parseSize(raw: string | null): number | null {
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * 下载并提交一个资源对象。错误分类：
 * 4xx / 超限 / 空响应 / 大小校验失败 = NonRetryableTaskError；网络中断与 5xx 走任务级重试。
 */
async function downloadObservedResource(
  observed: ObservedResource,
  context: { signal: AbortSignal, onProgress: (bytes: number, totalBytes: number | null) => void },
): Promise<TelegramResourceRecord> {
  const config = getTelegramCacheConfig()
  const identity = observed.identity
  if (!identity.downloadable || !identity.fetchUrl) {
    throw new NonRetryableTaskError('该资源没有可复用的 HTTP 地址（blob:/data: 一类只能由页面自行读取）')
  }

  const tmpDir = getTelegramTmpDir()
  await mkdir(tmpDir, { recursive: true })
  const tmpPath = path.join(tmpDir, `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.part`)

  const response = await getTelegramSession().fetch(identity.fetchUrl, {
    method: 'GET',
    signal: context.signal,
    redirect: 'follow',
    // 本地响应处理器安装后，下载请求也必须绕过它，避免自己命中自己
    bypassCustomProtocolHandlers: true,
  })

  if (!response.ok) {
    const status = response.status
    const retryable = status === 429 || status >= 500
    const message = `上游返回 ${status}`
    throw retryable ? new Error(message) : new NonRetryableTaskError(message)
  }

  const declared = parseSize(response.headers.get('content-length'))
  const contentEncoding = response.headers.get('content-encoding')
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || undefined
  const storedAt = Date.now()
  const cache = evaluateResponseCaching({
    mimeType,
    statusCode: response.status,
    cacheControl: response.headers.get('cache-control'),
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
    vary: response.headers.get('vary'),
    corsAllowOrigin: response.headers.get('access-control-allow-origin'),
    ageSeconds: parseSize(response.headers.get('age')),
    storedAt,
  })
  if (declared !== null && declared > config.maxResourceBytes) {
    throw new NonRetryableTaskError(`资源大小 ${declared} 字节超过上限 ${config.maxResourceBytes}`)
  }

  const body = response.body
  if (!body) throw new NonRetryableTaskError('响应没有内容')

  const hash = createHash('sha256')
  let size = 0
  const reader = body.getReader()

  // 用 pipeline 处理背压与错误传播：磁盘写失败 / 读取中断都会让 pipeline reject，
  // 不需要手写 drain 等待与 stream 错误监听（手写版本漏掉 error 会永久挂起）。
  async function* readChunks(): AsyncGenerator<Buffer> {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        size += chunk.length
        if (size > config.maxResourceBytes) {
          await reader.cancel().catch(() => {})
          throw new NonRetryableTaskError(`资源超过大小上限 ${config.maxResourceBytes} 字节`)
        }
        hash.update(chunk)
        context.onProgress(size, declared)
        yield chunk
      }
    } finally {
      try {
        await reader.cancel()
      } catch {
        // 已关闭，忽略
      }
      try {
        reader.releaseLock()
      } catch {
        // 已释放，忽略
      }
    }
  }

  try {
    context.onProgress(0, declared)
    await pipeline(Readable.from(readChunks()), createWriteStream(tmpPath))
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw error
  }

  if (size === 0) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw new NonRetryableTaskError('响应内容为空，未写入资源库')
  }
  // 有 content-length 且响应未被压缩时做大小校验：不一致视为截断，绝不登记为完整文件
  if (declared !== null && !contentEncoding && declared !== size) {
    await rm(tmpPath, { force: true }).catch(() => {})
    throw new NonRetryableTaskError(`大小校验失败：响应头 ${declared} 字节，实际 ${size} 字节`)
  }

  const digest = hash.digest('hex')
  const finalPath = objectPathForDigest(digest)
  await mkdir(path.dirname(finalPath), { recursive: true })
  if (existsSync(finalPath)) {
    // 内容已存在（同字节不同 URL，或被并发任务先写入）：复用对象，删除临时文件
    await rm(tmpPath, { force: true }).catch(() => {})
  } else {
    await rename(tmpPath, finalPath)
  }

  const record = recordTelegramContent({
    resourceKey: identity.resourceKey,
    displayUrl: identity.displayUrl,
    host: identity.host,
    mimeType,
    expectedSize: declared ?? undefined,
    actualSize: size,
    sha256: digest,
    relativePath: toTelegramRelativePath(finalPath),
    cache,
  })
  // 写索引后异步检查配额：不阻塞当前消费者，失败只记日志
  void enforceTelegramCacheQuota().catch((error: unknown) => {
    logger.warn('Telegram cache quota enforcement failed', { error: (error as Error).message })
  })
  logger.info('Telegram resource stored', {
    size,
    sha256: digest.slice(0, 12),
    mimeType: mimeType ?? 'unknown',
    cacheable: cache.cacheable,
    freshUntil: cache.freshUntil,
  })
  return record
}

/**
 * M3 路径 A：把页面已下载完成的响应体直接落库（来源 page-captured）。
 * 与下载路径共享内容寻址与索引：同内容不同来源不会重复占磁盘；不产生额外网络请求。
 */
export async function storeCapturedContent(input: {
  resourceKey: string
  displayUrl: string
  host: string
  mimeType?: string
  body: Buffer
  cache: CacheFreshness
}): Promise<TelegramResourceRecord> {
  const digest = createHash('sha256').update(input.body).digest('hex')
  const existing = getTelegramResourceRecord(input.resourceKey)
  if (existing && existing.sha256 === digest && isVerifiedCompleteRecord(existing)) {
    touchTelegramResource(input.resourceKey, 'cache')
    return existing
  }

  const finalPath = objectPathForDigest(digest)
  await mkdir(path.dirname(finalPath), { recursive: true })
  if (!existsSync(finalPath)) {
    const tmpDir = getTelegramTmpDir()
    await mkdir(tmpDir, { recursive: true })
    const tmpPath = path.join(tmpDir, `cap-${randomUUID().slice(0, 8)}.part`)
    await writeFile(tmpPath, input.body)
    try {
      await rename(tmpPath, finalPath)
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => {})
      if (!existsSync(finalPath)) throw error
    }
  }

  const record = recordTelegramContent({
    resourceKey: input.resourceKey,
    sourceType: 'page-captured',
    displayUrl: input.displayUrl,
    host: input.host,
    mimeType: input.mimeType,
    actualSize: input.body.length,
    sha256: digest,
    relativePath: toTelegramRelativePath(finalPath),
    cache: input.cache,
  })
  void enforceTelegramCacheQuota().catch((error: unknown) => {
    logger.warn('Telegram cache quota enforcement failed', { error: (error as Error).message })
  })
  logger.info('Telegram page-captured content stored', {
    size: input.body.length,
    sha256: digest.slice(0, 12),
    mimeType: input.mimeType ?? 'unknown',
  })
  return record
}

/**
 * 取得资源：命中资源库直接复用；否则进入单飞任务。
 * kind 只影响消费者优先级与完成后的动作（归档多一步复制），下载本身始终共享。
 */
export async function acquireTelegramResource(resourceKey: string, kind: TelegramResourceKind): Promise<AcquireResult> {
  const cached = getTelegramResourceRecord(resourceKey)
  if (cached && isVerifiedCompleteRecord(cached)) {
    const objectPath = resolveTelegramObjectPath(cached)
    if (objectPath && existsSync(objectPath)) {
      touchTelegramResource(resourceKey, kind)
      if (kind === 'archive') {
        const entry = await archiveTelegramResource(cached)
        return { record: cached, reused: true, joined: false, archiveRelativePath: entry.relativePath }
      }
      return { record: cached, reused: true, joined: false }
    }
  }

  const observed = getObservedResource(resourceKey)
  if (!observed) {
    throw new Error('该资源不在本次观测范围内：请先在页面里打开它，再回到资源清单操作')
  }
  if (!observed.identity.downloadable) {
    throw new Error('该资源没有可复用的 HTTP 地址（blob:/data: 一类只能由页面自行读取）')
  }

  const handle = getManager().acquire({
    resourceKey,
    taskId: `tg-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    displayUrl: observed.identity.displayUrl,
    host: observed.identity.host,
    priority: kind === 'archive' ? 1 : 2,
    maxAttempts: TELEGRAM_TASK_MAX_ATTEMPTS,
    runner: context => downloadObservedResource(observed, context),
  }, { id: `${kind}-${randomUUID()}`, kind })

  const record = await handle.promise
  if (kind === 'archive') {
    const entry = await archiveTelegramResource(record)
    return { record, reused: false, joined: handle.joined, archiveRelativePath: entry.relativePath, taskId: handle.taskId }
  }
  return { record, reused: false, joined: handle.joined, taskId: handle.taskId }
}

export { TaskCancelledError }
