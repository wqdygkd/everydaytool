// M1 + M2 + M3-B 自检：注入 runner 验证单飞协调器，纯函数验证 HTTP 缓存语义（不需要网络、不需要真实下载）。
// 覆盖方案文档 §15 的 M1 验收项：同键合并、异键隔离、取消传播、失败清理、重试；以及 M2 的缓存准入条件。
import type { Hash } from 'node:crypto'
import type { TelegramBenchmarkCounters, TelegramSelfTestResult, TelegramSelfTestStep } from '../../../../shared/telegram-cache.ts'
import type { AcquireTaskSpec, TaskRunContext } from './task-manager.ts'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { diffBenchmarkCounters } from './benchmark-core.ts'
import { evaluateResponseCaching, isCacheFresh, parseByteRange, refreshFreshnessFrom304, remainingFreshSeconds } from './http-semantics.ts'
import { committedBytes, isComplete, mergeRanges, missingRanges, planChunks } from './mtproto-chunk-plan.ts'
import { hashFilePrefix, runChunkedDownload } from './mtproto-download-core.ts'
import { parseMessageLink } from './mtproto-link.ts'
import { NonRetryableTaskError, SingleFlightTaskManager, TaskCancelledError } from './task-manager.ts'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function makeTempDir(): Promise<string> {
  try {
    return await mkdtemp(path.join(tmpdir(), 'edt-mtcore-'))
  } catch {
    // 受限沙箱下系统临时目录可能不可写：退回当前工作目录
    const dir = path.join(process.cwd(), `.mtcore-${Date.now().toString(36)}`)
    await mkdir(dir, { recursive: true })
    return dir
  }
}

function chunksOf(data: Buffer, offset: number, limit: number, chunkSize = 64 * 1024): AsyncIterable<Buffer> {
  return (async function* () {
    let pos = offset
    const end = Math.min(data.length, offset + limit)
    while (pos < end) {
      const next = Math.min(end, pos + chunkSize)
      yield data.subarray(pos, next)
      pos = next
    }
  })()
}

function makePayload(total: number): Buffer {
  const data = Buffer.alloc(total)
  for (let i = 0; i < total; i += 1) data[i] = i % 251
  return data
}

async function assertResumeResult(tmpPath: string, data: Buffer, hash: Hash): Promise<string | null> {
  const file = await readFile(tmpPath)
  if (!file.equals(data)) return '续传后的文件内容与源数据不一致'
  const expected = createHash('sha256').update(data).digest('hex')
  if (hash.digest('hex') !== expected) return '续传后 SHA-256 不一致'
  return null
}

function spec(
  resourceKey: string,
  taskId: string,
  runner: AcquireTaskSpec<string>['runner'],
  options: { priority?: number, maxAttempts?: number } = {},
): AcquireTaskSpec<string> {
  return {
    resourceKey,
    taskId,
    displayUrl: `https://example.test/${resourceKey}`,
    host: 'example.test',
    priority: options.priority ?? 2,
    maxAttempts: options.maxAttempts ?? 1,
    runner,
  }
}

async function step(name: string, run: () => Promise<string | null>): Promise<TelegramSelfTestStep> {
  try {
    const problem = await run()
    return { name, ok: problem === null, detail: problem ?? '通过' }
  } catch (error) {
    return { name, ok: false, detail: (error as Error).message }
  }
}

export async function runTelegramSelfTest(): Promise<TelegramSelfTestResult> {
  const steps: TelegramSelfTestStep[] = []

  steps.push(await step('同键并发只创建一个底层任务', async () => {
    const manager = new SingleFlightTaskManager<string>({ maxConcurrent: 2 })
    let runs = 0
    const runner = async (): Promise<string> => {
      runs += 1
      await sleep(30)
      return 'payload'
    }
    const first = manager.acquire(spec('k1', 't1', runner), { id: 'c1', kind: 'cache' })
    const second = manager.acquire(spec('k1', 't2', runner), { id: 'c2', kind: 'archive' })
    const [a, b] = await Promise.all([first.promise, second.promise])
    if (runs !== 1) return `底层任务跑了 ${runs} 次，期望 1 次`
    if (a !== 'payload' || b !== 'payload') return '消费者拿到的结果不一致'
    if (!second.joined) return '第二个消费者没有合并进已有任务'
    return null
  }))

  steps.push(await step('不同资源键互不合并', async () => {
    const manager = new SingleFlightTaskManager<string>({ maxConcurrent: 2 })
    let runs = 0
    const runner = async (): Promise<string> => {
      runs += 1
      await sleep(20)
      return 'ok'
    }
    const a = manager.acquire(spec('ka', 'ta', runner), { id: 'a', kind: 'cache' })
    const b = manager.acquire(spec('kb', 'tb', runner), { id: 'b', kind: 'cache' })
    await Promise.all([a.promise, b.promise])
    if (runs !== 2) return `底层任务跑了 ${runs} 次，期望 2 次`
    return null
  }))

  steps.push(await step('取消一个消费者不影响其他消费者', async () => {
    const manager = new SingleFlightTaskManager<string>({ maxConcurrent: 2 })
    let runs = 0
    const runner = async (): Promise<string> => {
      runs += 1
      await sleep(40)
      return 'kept'
    }
    const first = manager.acquire(spec('k', 't1', runner), { id: 'c1', kind: 'cache' })
    const second = manager.acquire(spec('k', 't2', runner), { id: 'c2', kind: 'archive' })
    const cancelled = first.promise.then(() => false).catch(error => error instanceof TaskCancelledError)
    manager.cancelConsumer('k', 'c1')
    const result = await second.promise
    if (!await cancelled) return '被取消的消费者没有收到取消错误'
    if (result !== 'kept') return '剩余消费者拿到的结果不对'
    if (runs !== 1) return `取消一个消费者导致底层任务重启（${runs} 次）`
    if (manager.getActiveCount() !== 0) return '任务完成后活动表仍有残留'
    return null
  }))

  steps.push(await step('全部消费者取消会中断底层任务且不留僵尸', async () => {
    const manager = new SingleFlightTaskManager<string>({ maxConcurrent: 1 })
    let aborted = false
    const runner = (context: TaskRunContext): Promise<string> => new Promise<string>((_resolve, reject) => {
      context.signal.addEventListener('abort', () => {
        aborted = true
        reject(new TaskCancelledError())
      }, { once: true })
    })
    const handle = manager.acquire(spec('k', 't', runner), { id: 'c1', kind: 'cache' })
    await sleep(20)
    manager.cancelTask('k')
    const rejected = await handle.promise.then(() => false).catch(error => error instanceof TaskCancelledError)
    await sleep(10)
    if (!rejected) return '任务取消后消费者没有收到取消错误'
    if (!aborted) return '底层任务没有收到 abort'
    if (manager.getActiveCount() !== 0) return '取消后活动任务表仍有残留'
    if (manager.getRunningCount() !== 0) return '取消后并发计数没有归还'
    return null
  }))

  steps.push(await step('任务失败会清理活动表并可重新发起', async () => {
    const manager = new SingleFlightTaskManager<string>({ maxConcurrent: 1 })
    const failing: AcquireTaskSpec<string>['runner'] = async () => {
      throw new NonRetryableTaskError('故意失败')
    }
    const handle = manager.acquire(spec('k', 't1', failing), { id: 'c1', kind: 'cache' })
    const failed = await handle.promise.then(() => false).catch(error => error instanceof NonRetryableTaskError)
    if (!failed) return '失败任务没有把错误传给消费者'
    if (manager.getActiveCount() !== 0) return '失败后活动任务表仍有残留'
    const retryHandle = manager.acquire(spec('k', 't2', async () => 'recovered'), { id: 'c2', kind: 'cache' })
    const result = await retryHandle.promise
    if (result !== 'recovered') return '失败后同一资源键无法重新发起任务'
    return null
  }))

  steps.push(await step('可重试错误按次数重试后成功', async () => {
    const manager = new SingleFlightTaskManager<string>({ maxConcurrent: 1 })
    const attempts: number[] = []
    const runner: AcquireTaskSpec<string>['runner'] = async (context) => {
      attempts.push(context.attempt)
      if (context.attempt < 2) throw new Error('模拟网络中断')
      return 'retried'
    }
    const handle = manager.acquire(spec('k', 't', runner, { maxAttempts: 2 }), { id: 'c1', kind: 'cache' })
    const result = await handle.promise
    if (result !== 'retried') return '重试后没有拿到成功结果'
    if (attempts.join(',') !== '1,2') return `尝试次数记录异常：${attempts.join(',')}`
    return null
  }))

  steps.push(await step('优先级高的排队任务先启动', async () => {
    const manager = new SingleFlightTaskManager<string>({ maxConcurrent: 1 })
    const started: string[] = []
    let releaseBlocker!: () => void
    const blockerGate = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    // 先占满并发（priority 0），再把 low(5) / high(1) 排进队列：释放后应按优先级启动
    const blocker = manager.acquire(spec('blocker', 't-blocker', async () => {
      started.push('blocker')
      await blockerGate
      return 'blocker'
    }, { priority: 0 }), { id: 'blocker', kind: 'cache' })
    const lowPriority = manager.acquire(spec('low', 't-low', async () => {
      started.push('low')
      return 'low'
    }, { priority: 5 }), { id: 'low', kind: 'cache' })
    const highPriority = manager.acquire(spec('high', 't-high', async () => {
      started.push('high')
      return 'high'
    }, { priority: 1 }), { id: 'high', kind: 'cache' })
    await sleep(20)
    releaseBlocker()
    await Promise.all([blocker.promise, lowPriority.promise, highPriority.promise])
    if (started.join(',') !== 'blocker,high,low') return `启动顺序异常：${started.join(',')}`
    return null
  }))

  steps.push(await step('HTTP 语义：no-store / private / no-cache 不本地复用', async () => {
    const storedAt = Date.now()
    const base = { mimeType: 'image/jpeg', statusCode: 200, storedAt }
    const noStore = evaluateResponseCaching({ ...base, cacheControl: 'no-store, max-age=600' })
    if (noStore.cacheable) return 'no-store 被判定为可本地复用'
    if (noStore.quotaManaged) return 'no-store 被计入缓存配额'
    const privateResponse = evaluateResponseCaching({ ...base, cacheControl: 'private, max-age=600' })
    if (privateResponse.cacheable) return 'private 被判定为可本地复用'
    const noCache = evaluateResponseCaching({ ...base, cacheControl: 'no-cache, max-age=600' })
    if (noCache.cacheable) return 'no-cache 被判定为可本地复用'
    return null
  }))

  steps.push(await step('HTTP 语义：新鲜期 / Vary / Age 计算正确', async () => {
    const storedAt = 1_800_000_000_000
    const fresh = evaluateResponseCaching({
      mimeType: 'image/jpeg',
      statusCode: 200,
      cacheControl: 'public, max-age="600"',
      vary: 'Accept-Encoding',
      storedAt,
    })
    if (!fresh.cacheable) return '图片 + max-age + Accept-Encoding 应可本地复用'
    if (fresh.freshUntil !== storedAt + 600_000) return `freshUntil 计算错误：${fresh.freshUntil}`
    if (!isCacheFresh(fresh, storedAt + 599_000)) return '新鲜期内应命中'
    if (isCacheFresh(fresh, storedAt + 601_000)) return '过期后不应命中'
    if (remainingFreshSeconds(fresh, storedAt + 60_000) !== 540) return '剩余新鲜期计算错误'

    const aged = evaluateResponseCaching({
      mimeType: 'image/jpeg',
      statusCode: 200,
      cacheControl: 'max-age=600',
      ageSeconds: 600,
      storedAt,
    })
    if (isCacheFresh(aged, storedAt)) return 'Age 已耗尽新鲜期时不应命中'

    const cookieVary = evaluateResponseCaching({
      mimeType: 'image/jpeg',
      statusCode: 200,
      cacheControl: 'max-age=600',
      vary: 'Cookie',
      storedAt,
    })
    if (cookieVary.cacheable) return 'Vary: Cookie 被判定为可本地复用'
    return null
  }))

  steps.push(await step('HTTP 语义：非图片 / 无 max-age 不本地复用', async () => {
    const storedAt = Date.now()
    const video = evaluateResponseCaching({
      mimeType: 'video/mp4',
      statusCode: 200,
      cacheControl: 'max-age=600',
      storedAt,
    })
    // 媒体在 M2 第二轮开放，但必须归入 media 类别（由独立开关控制）
    if (!video.cacheable || video.serveClass !== 'media') return '音视频应归入 media 类别且 HTTP 允许缓存'
    const doc = evaluateResponseCaching({
      mimeType: 'application/pdf',
      statusCode: 200,
      cacheControl: 'max-age=600',
      storedAt,
    })
    if (doc.cacheable || doc.serveClass !== 'none') return '非媒体被判定为可本地复用'
    const noMaxAge = evaluateResponseCaching({
      mimeType: 'image/jpeg',
      statusCode: 200,
      cacheControl: 'public',
      storedAt,
    })
    if (noMaxAge.cacheable || noMaxAge.freshUntil !== null) return '没有 max-age 时不应做启发式新鲜度'
    return null
  }))

  steps.push(await step('单区间 Range 解析（206 前置条件）', async () => {
    const size = 200
    if (JSON.stringify(parseByteRange('bytes=0-99', size)) !== JSON.stringify({ start: 0, end: 99 })) return '起止区间解析错误'
    if (JSON.stringify(parseByteRange('bytes=100-', size)) !== JSON.stringify({ start: 100, end: 199 })) return '开放区间解析错误'
    if (JSON.stringify(parseByteRange('bytes=-50', size)) !== JSON.stringify({ start: 150, end: 199 })) return '后缀区间解析错误'
    if (JSON.stringify(parseByteRange('bytes=0-999', size)) !== JSON.stringify({ start: 0, end: 199 })) return '越界结束位应被截断'
    if (parseByteRange('bytes=500-', size) !== 'unsatisfiable') return '起点越界应返回 416'
    if (parseByteRange('bytes=0-1,3-4', size) !== null) return '多区间应回源而不是自行拼接'
    if (parseByteRange('bytes=5-2', size) !== null) return '非法区间应回源'
    if (parseByteRange(null, size) !== null) return '无 Range 头不应命中区间分支'
    return null
  }))

  steps.push(await step('304 刷新新鲜期且尊重不允许缓存的响应头', async () => {
    const storedAt = 1_800_000_000_000
    const previous = evaluateResponseCaching({
      mimeType: 'image/jpeg',
      statusCode: 200,
      cacheControl: 'max-age=60',
      etag: '"v1"',
      storedAt,
    })
    const refreshed = refreshFreshnessFrom304(previous, {
      cacheControl: 'max-age=600',
      storedAt: storedAt + 120_000,
    })
    if (refreshed.freshUntil !== storedAt + 120_000 + 600_000) return '304 刷新后的新鲜期计算错误'
    if (!isCacheFresh(refreshed, storedAt + 300_000)) return '304 刷新后应重新处于新鲜期'
    if (refreshed.etag !== '"v1"') return '304 未携带 ETag 时应沿用旧值'
    const denied = refreshFreshnessFrom304(previous, {
      cacheControl: 'no-store',
      storedAt: storedAt + 120_000,
    })
    if (denied.cacheable) return '304 返回 no-store 时不应继续本地复用'
    return null
  }))

  steps.push(await step('MTProto 分块规划（字节数学）', async () => {
    const chunks = planChunks(2500, 1000)
    if (chunks.length !== 3) return `分块数量错误：${chunks.length}`
    if (chunks[0].offset !== 0 || chunks[0].limit !== 1000) return '首块 offset / limit 错误'
    if (chunks[2].offset !== 2000 || chunks[2].limit !== 500) return '末块应截断到文件长度'
    if (planChunks(0, 1000).length !== 0) return '空文件不应产生分块'
    let threw = false
    try {
      planChunks(100, 0)
    } catch {
      threw = true
    }
    if (!threw) return '非法 chunkSize 应抛错'
    return null
  }))

  steps.push(await step('MTProto 续传区间：合并 / 连续提交量 / 缺口', async () => {
    const merged = mergeRanges([
      { start: 0, end: 99 },
      { start: 100, end: 199 },
      { start: 300, end: 399 },
      { start: 250, end: 350 },
    ])
    if (JSON.stringify(merged) !== JSON.stringify([{ start: 0, end: 199 }, { start: 250, end: 399 }])) {
      return `区间合并错误：${JSON.stringify(merged)}`
    }
    if (committedBytes([{ start: 0, end: 99 }, { start: 200, end: 299 }]) !== 100) {
      return '有洞时连续提交量应停在洞前'
    }
    const missing = missingRanges([{ start: 0, end: 99 }, { start: 200, end: 299 }], 400)
    if (JSON.stringify(missing) !== JSON.stringify([{ start: 100, end: 199 }, { start: 300, end: 399 }])) {
      return `缺口计算错误：${JSON.stringify(missing)}`
    }
    if (!isComplete([{ start: 0, end: 399 }], 400)) return '连续覆盖应判定为完整'
    if (isComplete([{ start: 0, end: 99 }], 400)) return '缺半段不应判定为完整'
    if (mergeRanges([{ start: 10, end: 5 }, { start: -1, end: 2 }]).length !== 0) return '非法区间应被丢弃'
    return null
  }))

  steps.push(await step('分块下载核心：取消后保留连续前缀并可续传', async () => {
    const total = 300 * 1024
    const data = makePayload(total)
    const dir = await makeTempDir()
    const tmpPath = path.join(dir, 'abort.part')
    try {
      const controller = new AbortController()
      const state = { committed: 0 }
      const hash = createHash('sha256')
      await runChunkedDownload({
        tmpPath,
        totalSize: total,
        hash,
        state,
        signal: controller.signal,
        createIterator: () => (async function* () {
          let pos = 0
          while (pos < total) {
            const next = Math.min(total, pos + 64 * 1024)
            yield data.subarray(pos, next)
            pos = next
            if (pos >= 128 * 1024) {
              controller.abort()
              return
            }
          }
        })(),
      })
      if (state.committed !== 128 * 1024) return `取消后 committed=${state.committed}，期望 131072`
      const info = await stat(tmpPath)
      if (info.size !== state.committed) return `取消后文件大小 ${info.size} 与 committed 不一致`
      // 模拟调用方重试前的截断
      await truncate(tmpPath, state.committed)
      const resumeHash = createHash('sha256')
      await hashFilePrefix(tmpPath, state.committed, resumeHash)
      const resumeState = { committed: state.committed }
      await runChunkedDownload({
        tmpPath,
        totalSize: total,
        hash: resumeHash,
        state: resumeState,
        signal: new AbortController().signal,
        createIterator: (offset, limit) => chunksOf(data, offset, limit),
      })
      return assertResumeResult(tmpPath, data, resumeHash)
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }))

  steps.push(await step('分块下载核心：异常后续传哈希一致', async () => {
    const total = 300 * 1024
    const data = makePayload(total)
    const dir = await makeTempDir()
    const tmpPath = path.join(dir, 'fail.part')
    try {
      const state = { committed: 0 }
      const hash = createHash('sha256')
      let threw = false
      try {
        await runChunkedDownload({
          tmpPath,
          totalSize: total,
          hash,
          state,
          signal: new AbortController().signal,
          createIterator: () => (async function* () {
            yield data.subarray(0, 64 * 1024)
            yield data.subarray(64 * 1024, 128 * 1024)
            throw new Error('模拟网络中断')
          })(),
        })
      } catch {
        threw = true
      }
      if (!threw) return '注入的异常没有被抛出'
      if (state.committed !== 128 * 1024) return `异常后 committed=${state.committed}，期望 131072`
      await truncate(tmpPath, state.committed)
      const resumeHash = createHash('sha256')
      await hashFilePrefix(tmpPath, state.committed, resumeHash)
      await runChunkedDownload({
        tmpPath,
        totalSize: total,
        hash: resumeHash,
        state: { committed: state.committed },
        signal: new AbortController().signal,
        createIterator: (offset, limit) => chunksOf(data, offset, limit),
      })
      return assertResumeResult(tmpPath, data, resumeHash)
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }))

  steps.push(await step('消息链接解析（MTProto 前置）', async () => {
    const publicLink = parseMessageLink('https://t.me/durov/123?single')
    if (!publicLink || publicLink.source !== 'public' || publicLink.username !== 'durov' || publicLink.messageId !== 123) {
      return '公开频道链接解析错误'
    }
    const privateLink = parseMessageLink('https://t.me/c/1234567890/42/99')
    if (!privateLink || privateLink.source !== 'private' || privateLink.channelId !== '1234567890' || privateLink.messageId !== 42 || privateLink.topicId !== 99) {
      return '私密频道链接解析错误'
    }
    if (parseMessageLink('https://t.me/+AbCdEf') !== null) return '邀请链接不应被接受'
    if (parseMessageLink('https://example.com/a/1') !== null) return '非 Telegram 域名不应被接受'
    if (parseMessageLink('https://t.me/durov') !== null) return '缺少消息 ID 不应被接受'
    return null
  }))

  steps.push(await step('基准测试计数差值（含回绕检测）', async () => {
    const start: TelegramBenchmarkCounters = {
      requests: 10,
      completed: 9,
      failed: 1,
      fromCache: 2,
      networkBytes: 1000,
      unknownSizeCount: 1,
      cacheServedBytes: 100,
      localHits: 1,
      localMisses: 2,
      revalidations: 0,
      revalidationHits: 0,
      pageCapturedBytes: 0,
    }
    const end: TelegramBenchmarkCounters = {
      ...start,
      requests: 16,
      completed: 15,
      fromCache: 4,
      networkBytes: 1600,
      cacheServedBytes: 500,
      localHits: 3,
      localMisses: 4,
      revalidations: 1,
      revalidationHits: 1,
      pageCapturedBytes: 200,
    }
    const normal = diffBenchmarkCounters(start, end)
    if (normal.resetDetected) return '正常增量不应标记回绕'
    if (normal.counters.requests !== 6) return `请求差值错误：${normal.counters.requests}`
    if (normal.counters.networkBytes !== 600) return `网络字节差值错误：${normal.counters.networkBytes}`
    if (normal.counters.cacheServedBytes !== 400) return `本地复用差值错误：${normal.counters.cacheServedBytes}`
    if (normal.counters.pageCapturedBytes !== 200) return `页面捕获差值错误：${normal.counters.pageCapturedBytes}`
    const reset = diffBenchmarkCounters(end, start)
    if (!reset.resetDetected) return '计数回绕未被检测'
    if (reset.counters.requests !== 0) return '回绕字段应归零而不是负数'
    return null
  }))

  return { ok: steps.every(item => item.ok), steps, ranAt: Date.now() }
}
