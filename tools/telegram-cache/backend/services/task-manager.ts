// 单飞任务协调器（方案文档 §6）：同一资源键同时只允许一个底层下载任务，
// 后来者作为消费者加入；消费者各自可取消，只有全部取消才中断底层任务。
//
// 不依赖 Electron / 文件系统，便于用「注入 runner」的方式做自检（self-test）：
// 合并、隔离、取消传播、失败清理、并发竞争都能在进程内可复现地验证。
import type { TelegramResourceKind, TelegramTaskSnapshot, TelegramTaskStatus } from '../../../../shared/telegram-cache.ts'

export class TaskCancelledError extends Error {
  constructor(message = '任务已取消') {
    super(message)
    this.name = 'TaskCancelledError'
  }
}

/** 不可重试错误（4xx / 超出大小上限 / 非 http(s)）：不消耗重试次数，直接失败 */
export class NonRetryableTaskError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetryableTaskError'
  }
}

export interface TaskRunContext {
  signal: AbortSignal
  /** 第几次尝试（从 1 开始） */
  attempt: number
  onProgress: (bytes: number, totalBytes: number | null) => void
}

export interface AcquireTaskSpec<T> {
  resourceKey: string
  taskId: string
  displayUrl: string
  host: string
  /** 越小越优先：0 正在观看 / 1 用户主动 / 2 可视区 / 3 聊天补齐 / 4 后台 / 5 预取 */
  priority: number
  /** 最多尝试次数（含首次），默认 1（不重试） */
  maxAttempts?: number
  runner: (context: TaskRunContext) => Promise<T>
}

export interface AcquireHandle<T> {
  taskId: string
  taskKey: string
  /** true = 加入了已有任务（未新建底层任务） */
  joined: boolean
  promise: Promise<T>
}

interface Consumer<T> {
  id: string
  kind: TelegramResourceKind
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

interface Task<T> {
  taskId: string
  resourceKey: string
  displayUrl: string
  host: string
  priority: number
  status: TelegramTaskStatus
  consumers: Map<string, Consumer<T>>
  kinds: Set<TelegramResourceKind>
  bytes: number
  totalBytes: number | null
  attempts: number
  error?: string
  queuedAt: number
  startedAt?: number
  finishedAt?: number
  controller?: AbortController
  runner: (context: TaskRunContext) => Promise<T>
  maxAttempts: number
  joinedConsumers: number
  settled: boolean
  slotHeld: boolean
  lastProgressAt: number
}

export interface TaskManagerOptions {
  maxConcurrent: number
  onChange?: (snapshot: TelegramTaskSnapshot) => void
  historyLimit?: number
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    function onAbort(): void {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export class SingleFlightTaskManager<T> {
  private readonly active = new Map<string, Task<T>>()
  private readonly history: TelegramTaskSnapshot[] = []
  private maxConcurrent: number
  private readonly onChange?: (snapshot: TelegramTaskSnapshot) => void
  private readonly historyLimit: number
  private running = 0

  constructor(options: TaskManagerOptions) {
    this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent))
    this.onChange = options.onChange
    this.historyLimit = options.historyLimit ?? 50
  }

  setMaxConcurrent(value: number): void {
    this.maxConcurrent = Math.max(1, Math.floor(value))
    this.pump()
  }

  /** 新建或加入任务；返回的 promise 只代表「这个消费者」的结果 */
  acquire(spec: AcquireTaskSpec<T>, consumer: { id: string, kind: TelegramResourceKind }): AcquireHandle<T> {
    const existing = this.active.get(spec.resourceKey)
    if (existing) {
      return this.join(existing, consumer)
    }

    let resolveConsumer!: (value: T) => void
    let rejectConsumer!: (error: unknown) => void
    const promise = new Promise<T>((resolve, reject) => {
      resolveConsumer = resolve
      rejectConsumer = reject
    })

    const task: Task<T> = {
      taskId: spec.taskId,
      resourceKey: spec.resourceKey,
      displayUrl: spec.displayUrl,
      host: spec.host,
      priority: spec.priority,
      status: 'queued',
      consumers: new Map([[consumer.id, {
        id: consumer.id,
        kind: consumer.kind,
        resolve: resolveConsumer,
        reject: rejectConsumer,
      }]]),
      kinds: new Set([consumer.kind]),
      bytes: 0,
      totalBytes: null,
      attempts: 0,
      queuedAt: Date.now(),
      runner: spec.runner,
      maxAttempts: Math.max(1, Math.floor(spec.maxAttempts ?? 1)),
      joinedConsumers: 1,
      settled: false,
      slotHeld: false,
      lastProgressAt: 0,
    }

    this.active.set(task.resourceKey, task)
    this.emit(task)
    this.pump()

    return { taskId: task.taskId, taskKey: task.resourceKey, joined: false, promise }
  }

  private join(task: Task<T>, consumer: { id: string, kind: TelegramResourceKind }): AcquireHandle<T> {
    let resolveConsumer!: (value: T) => void
    let rejectConsumer!: (error: unknown) => void
    const promise = new Promise<T>((resolve, reject) => {
      resolveConsumer = resolve
      rejectConsumer = reject
    })

    task.consumers.set(consumer.id, {
      id: consumer.id,
      kind: consumer.kind,
      resolve: resolveConsumer,
      reject: rejectConsumer,
    })
    task.kinds.add(consumer.kind)
    task.joinedConsumers += 1
    // 合并进来的消费者优先级更高且任务还在排队时，提升任务优先级（更贴近用户当前意图）
    if (consumer.kind === 'archive' && task.status === 'queued') {
      task.priority = Math.min(task.priority, 1)
    }
    this.emit(task)
    this.pump()

    return { taskId: task.taskId, taskKey: task.resourceKey, joined: true, promise }
  }

  /** 取消某个消费者；其他消费者仍可完成，全部取消才中断底层任务 */
  cancelConsumer(taskKey: string, consumerId: string): boolean {
    const task = this.active.get(taskKey)
    if (!task) return false
    const consumer = task.consumers.get(consumerId)
    if (!consumer) return false
    task.consumers.delete(consumerId)
    consumer.reject(new TaskCancelledError('消费者已取消'))
    if (task.consumers.size === 0) {
      this.cancelTask(taskKey)
      return true
    }
    this.emit(task)
    return true
  }

  /** 取消整个任务（UI 的「取消任务」）：中断底层下载并拒绝所有消费者 */
  cancelTask(taskKey: string): boolean {
    const task = this.active.get(taskKey)
    if (!task || task.settled) return false
    this.settleCancelled(task)
    return true
  }

  cancelAll(): void {
    for (const key of [...this.active.keys()]) {
      this.cancelTask(key)
    }
  }

  getSnapshots(): TelegramTaskSnapshot[] {
    const active = [...this.active.values()]
      .map(task => this.toSnapshot(task))
      .sort((a, b) => {
        const rank = (status: TelegramTaskStatus): number => (status === 'running' ? 0 : 1)
        return rank(a.status) - rank(b.status) || a.queuedAt - b.queuedAt
      })
    return [...active, ...this.history]
  }

  getActiveCount(): number {
    return this.active.size
  }

  getRunningCount(): number {
    return this.running
  }

  private pump(): void {
    while (this.running < this.maxConcurrent) {
      const next = this.takeNext()
      if (!next) return
      this.start(next)
    }
  }

  private takeNext(): Task<T> | null {
    let best: Task<T> | null = null
    for (const task of this.active.values()) {
      if (task.status !== 'queued') continue
      if (!best
        || task.priority < best.priority
        || (task.priority === best.priority && task.queuedAt < best.queuedAt)) {
        best = task
      }
    }
    return best
  }

  private start(task: Task<T>): void {
    task.status = 'running'
    task.startedAt = Date.now()
    task.slotHeld = true
    this.running += 1
    this.emit(task)
    void this.run(task)
  }

  private async run(task: Task<T>): Promise<void> {
    while (!task.settled) {
      task.attempts += 1
      const controller = new AbortController()
      task.controller = controller
      try {
        const result = await task.runner({
          signal: controller.signal,
          attempt: task.attempts,
          onProgress: (bytes, totalBytes) => this.reportProgress(task, bytes, totalBytes),
        })
        if (task.settled) return
        this.settleSuccess(task, result)
        return
      } catch (error) {
        if (task.settled) return
        if (controller.signal.aborted) {
          // 取消路径已由 cancelTask 结算，这里只需结束循环
          this.settleCancelled(task)
          return
        }
        const retryable = !(error instanceof NonRetryableTaskError) && task.attempts < task.maxAttempts
        if (!retryable) {
          this.settleFailure(task, error)
          return
        }
        const waited = await abortableDelay(Math.min(4000, 300 * 2 ** (task.attempts - 1)), controller.signal)
        if (!waited || task.settled) {
          if (!task.settled) this.settleCancelled(task)
          return
        }
      }
    }
  }

  private reportProgress(task: Task<T>, bytes: number, totalBytes: number | null): void {
    if (task.settled) return
    task.bytes = bytes
    if (totalBytes !== null) task.totalBytes = totalBytes
    const now = Date.now()
    // 进度节流：高频 chunk 不逐条广播，避免 IPC 被进度事件淹没
    if (now - task.lastProgressAt < 250) return
    task.lastProgressAt = now
    this.emit(task)
  }

  private settleSuccess(task: Task<T>, result: T): void {
    if (task.settled) return
    task.status = 'completed'
    this.finish(task)
    for (const consumer of task.consumers.values()) consumer.resolve(result)
    task.consumers.clear()
  }

  private settleFailure(task: Task<T>, error: unknown): void {
    if (task.settled) return
    task.status = 'failed'
    task.error = error instanceof Error ? error.message : String(error)
    this.finish(task)
    for (const consumer of task.consumers.values()) consumer.reject(error)
    task.consumers.clear()
  }

  private settleCancelled(task: Task<T>): void {
    if (task.settled) return
    task.status = 'cancelled'
    task.error = '任务已取消'
    // 先中断底层下载再结算：run() 的 catch 看到 settled 后直接返回，不会重复结算
    task.controller?.abort()
    this.finish(task)
    for (const consumer of task.consumers.values()) consumer.reject(new TaskCancelledError())
    task.consumers.clear()
  }

  private finish(task: Task<T>): void {
    if (task.settled) return
    task.settled = true
    task.finishedAt = Date.now()
    if (task.slotHeld) {
      task.slotHeld = false
      this.running = Math.max(0, this.running - 1)
    }
    if (this.active.get(task.resourceKey) === task) {
      this.active.delete(task.resourceKey)
    }
    const snapshot = this.toSnapshot(task)
    this.history.unshift(snapshot)
    if (this.history.length > this.historyLimit) this.history.length = this.historyLimit
    if (this.onChange) this.onChange(snapshot)
    this.pump()
  }

  private emit(task: Task<T>): void {
    if (!this.onChange) return
    this.onChange(this.toSnapshot(task))
  }

  private toSnapshot(task: Task<T>): TelegramTaskSnapshot {
    return {
      taskId: task.taskId,
      resourceKey: task.resourceKey,
      displayUrl: task.displayUrl,
      host: task.host,
      status: task.status,
      priority: task.priority,
      consumers: task.consumers.size,
      joinedConsumers: task.joinedConsumers,
      kinds: [...task.kinds],
      bytes: task.bytes,
      totalBytes: task.totalBytes,
      attempts: task.attempts,
      error: task.error,
      queuedAt: task.queuedAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
    }
  }
}
