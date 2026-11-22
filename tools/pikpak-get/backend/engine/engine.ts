import type { PikpakFetch, PikpakLogger, PikpakStop } from './api.ts'
import type { PikpakLink } from './links.ts'
import type { PikpakNode, PipelineArgs } from './pipeline.ts'
import type { QueueSummary } from './progress-log.ts'
// 引擎门面：组合账号池 / 链接库 / 任务存储，提供统一的同步接口。
// 本机模式直接 new 一个 PikpakEngine 调用；NAS 模式由 service.ts 把它包成 HTTP 端点。
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AccountStore } from './accounts.ts'
import { PikpakError } from './errors.ts'
import { LinkStore } from './links.ts'
import { Pipeline } from './pipeline.ts'
import {
  formatFileDone,
  formatFileProgress,
  formatFileStart,
  formatTaskEnd,
  formatTaskQueued,
  formatTaskStart,
} from './progress-log.ts'

export interface EngineContext {
  configDir: string
  destDir: string
  masterKey: string
  fetchImpl?: PikpakFetch
  logger?: PikpakLogger
  stop?: PikpakStop
  /** stdout 进度日志的刷新间隔（秒）；0 = 只打里程碑、不做周期刷新 */
  progressSeconds?: number
}

export interface TaskFile {
  node_id: string
  name: string
  size: number
  downloaded: number
  speed: number
  eta: number
}

export type TaskStatus = 'queued' | 'running' | 'cancelling' | 'done' | 'partial' | 'error' | 'cancelled'

export interface PikpakTask {
  id: string
  link_id: string
  file_ids: string[] | null
  dest: string
  account_id: string | null
  status: TaskStatus
  current_file: string | null
  files: Record<string, TaskFile>
  logs: { ts: string, level: string, message: string }[]
  error: string | null
  created_at: string
  updated_at: string
  /** 入队时按解析缓存算出的计划量：排队中也能知道「还要下多少」 */
  planned_files: number
  planned_bytes: number
}

const MAX_LOG_LINES = 200

export class PikpakEngine {
  readonly accounts: AccountStore
  readonly links: LinkStore
  private readonly configDir: string
  private readonly destDir: string
  private readonly masterKey: string
  private readonly stop?: PikpakStop
  private tasks = new Map<string, PikpakTask>()
  private stopFlags = new Map<string, { stopped: boolean }>()
  private progressSamples = new Map<string, { lastBytes: number, lastAt: number, lastSpeed: number, lastEta: number }>()
  private queue: string[] = []
  private workerRunning = false
  private readonly progressSeconds: number
  private progressTimer: ReturnType<typeof setInterval> | null = null
  /** 每个任务上次打过「下载中」的文件 id（用于打文件开始 / 完成里程碑） */
  private lastLoggedFile = new Map<string, string>()
  private loggedDoneFiles = new Set<string>()
  private loggedEnd = new Set<string>()

  constructor(context: EngineContext) {
    this.configDir = context.configDir
    this.destDir = context.destDir
    this.masterKey = context.masterKey
    this.stop = context.stop
    this.progressSeconds = Math.max(0, Math.floor(context.progressSeconds ?? 15))
    this.accounts = new AccountStore(context)
    this.links = new LinkStore(context.configDir)
  }

  private now(): string {
    return new Date().toISOString()
  }

  /**
   * 进度日志的唯一出口：写 stdout，NAS 里 `docker compose logs -f` 直接可见。
   * 引擎要能脱离 Electron 单独打包运行（NAS 容器），所以不能用平台 logger，只能用 console。
   */
  private progress(line: string): void {
    // eslint-disable-next-line no-console -- 见上：引擎在容器里没有平台 logger 可用
    console.log(line)
  }

  get destRoot(): string {
    return this.destDir
  }

  private publicTask(task: PikpakTask): PikpakTask {
    return {
      ...task,
      files: Object.fromEntries(Object.entries(task.files).map(([key, value]) => [key, { ...value }])),
      logs: [...task.logs],
    }
  }

  // ------------------------------------------------------------------- tasks
  async createTask(linkId: string, fileIds: string[] | null, dest?: string | null, accountId?: string | null): Promise<PikpakTask> {
    const link = await this.links.get(linkId)
    if (!link) throw new PikpakError(`分享链接不存在：${linkId}`)
    const planned = await this.plannedFor(linkId, fileIds)
    const task: PikpakTask = {
      id: `task-${Date.now()}-${randomUUID().slice(0, 8)}`,
      link_id: linkId,
      file_ids: fileIds?.length ? fileIds : null,
      dest: (dest || this.destDir).trim(),
      account_id: accountId || null,
      status: 'queued',
      current_file: null,
      files: {},
      logs: [],
      error: null,
      created_at: this.now(),
      updated_at: this.now(),
      planned_files: planned.files,
      planned_bytes: planned.bytes,
    }
    this.tasks.set(task.id, task)
    this.stopFlags.set(task.id, { stopped: false })
    // 入队即打一行：此时队列里已包含本任务，能直接看出「还要下多少」
    this.progress(formatTaskQueued(task.id, planned.files, planned.bytes, this.queueSummary(task.id)))
    return this.publicTask(task)
  }

  /** 按解析缓存估算任务要下多少（排队中也能给出文件数与体积） */
  private async plannedFor(linkId: string, fileIds: string[] | null): Promise<{ files: number, bytes: number }> {
    if (!fileIds?.length) return { files: 0, bytes: 0 }
    const cache = await this.links.getParseCache(linkId)
    // 没有解析缓存（还没解析过）时只能给出文件数，体积未知按 0
    if (!cache) return { files: fileIds.length, bytes: 0 }
    const wanted = new Set(fileIds)
    const selected = (cache.cache.nodes as PikpakNode[])
      .filter(node => !node.is_folder && wanted.has(node.id))
    // 缓存里对不上任何 id（例如缓存被清理过）时，至少保留勾选数
    const files = selected.length || fileIds.length
    const bytes = selected.reduce((sum, node) => sum + (Number(node.size) || 0), 0)
    return { files, bytes }
  }

  /** 排队快照：状态为 queued 的任务，可排除某个任务（它自己不算「排在自己前面」） */
  private queueSummary(excludeTaskId?: string): QueueSummary {
    let tasks = 0
    let files = 0
    let bytes = 0
    for (const task of this.tasks.values()) {
      if (task.id === excludeTaskId) continue
      if (task.status !== 'queued') continue
      tasks += 1
      files += task.planned_files
      bytes += task.planned_bytes
    }
    return { tasks, files, bytes }
  }

  /** 当前文件在任务里的序号（1 基）与计划文件数 */
  private filePosition(task: PikpakTask): { index: number, count: number } {
    const index = task.current_file ? Object.keys(task.files).indexOf(task.current_file) + 1 : 0
    return { index: Math.max(index, 0), count: task.planned_files || Object.keys(task.files).length }
  }

  private startProgressTimer(): void {
    if (this.progressTimer || this.progressSeconds <= 0) return
    this.progressTimer = setInterval(() => {
      const task = [...this.tasks.values()].find(item => item.status === 'running')
      if (!task?.current_file) return
      const entry = task.files[task.current_file]
      if (!entry) return
      const { index, count } = this.filePosition(task)
      this.progress(formatFileProgress(index, count, entry.name, entry.downloaded, entry.size, entry.speed, entry.eta, this.queueSummary(task.id)))
    }, this.progressSeconds * 1000)
    // 定时器不该拖住进程退出（NAS 里由 systemd/docker 管进程，本地是 Electron 主进程）
    this.progressTimer.unref?.()
  }

  private stopProgressTimer(): void {
    if (!this.progressTimer) return
    clearInterval(this.progressTimer)
    this.progressTimer = null
  }

  getTask(taskId: string): PikpakTask | null {
    const task = this.tasks.get(taskId)
    return task ? this.publicTask(task) : null
  }

  listTasks(): PikpakTask[] {
    return [...this.tasks.values()].map(task => this.publicTask(task))
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    const flag = this.stopFlags.get(taskId)
    if (!task || !flag) return false
    if (['done', 'error', 'cancelled'].includes(task.status)) return false
    task.status = 'cancelling'
    task.updated_at = this.now()
    flag.stopped = true
    return true
  }

  enqueue(taskId: string): void {
    this.queue.push(taskId)
    this.startProgressTimer()
    void this.drainQueue()
  }

  private async drainQueue(): Promise<void> {
    if (this.workerRunning) return
    this.workerRunning = true
    try {
      while (this.queue.length) {
        const taskId = this.queue.shift()!
        try {
          await this.runTask(taskId)
        } catch (error) {
          this.finalize(taskId, 'error', (error as Error).message)
          this.addLog(taskId, 'error', (error as Error).message)
        }
      }
    } finally {
      this.workerRunning = false
      // 队列清空后停止周期刷新，避免空转刷日志
      if (this.queue.length === 0) this.stopProgressTimer()
    }
  }

  private addLog(taskId: string, level: string, message: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.logs.push({ ts: this.now(), level, message: String(message) })
    if (task.logs.length > MAX_LOG_LINES) task.logs = task.logs.slice(-MAX_LOG_LINES)
    task.updated_at = this.now()
  }

  private setFileProgress(taskId: string, node: PikpakNode, written: number): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    const entry = task.files[node.id] ??= { node_id: node.id, name: node.name, size: node.size, downloaded: 0, speed: 0, eta: 0 }
    entry.downloaded = written
    task.current_file = node.id
    task.updated_at = this.now()

    const now = Date.now()
    const sample = this.progressSamples.get(taskId) ?? { lastBytes: 0, lastAt: now, lastSpeed: 0, lastEta: 0 }
    if (now - sample.lastAt >= 1000) {
      const dt = (now - sample.lastAt) / 1000
      if (dt > 0) sample.lastSpeed = Math.max(0, (written - sample.lastBytes) / dt)
      const remaining = entry.size - written
      sample.lastEta = sample.lastSpeed > 0 ? remaining / sample.lastSpeed : 0
      sample.lastBytes = written
      sample.lastAt = now
    }
    entry.speed = Math.round(sample.lastSpeed)
    entry.eta = Math.round(sample.lastEta)
    this.progressSamples.set(taskId, sample)

    // 里程碑只在「换了文件」「刚下完」这两个边沿打一行，进度百分比交给周期刷新
    const { index, count } = this.filePosition(task)
    if (this.lastLoggedFile.get(taskId) !== node.id) {
      this.lastLoggedFile.set(taskId, node.id)
      this.progress(formatFileStart(index, count, node.name, entry.size, this.queueSummary(taskId)))
    }
    const doneKey = `${taskId}:${node.id}`
    if (entry.size > 0 && written >= entry.size && !this.loggedDoneFiles.has(doneKey)) {
      this.loggedDoneFiles.add(doneKey)
      const seconds = sample.lastSpeed > 0 ? entry.size / sample.lastSpeed : 0
      this.progress(formatFileDone(index, count, node.name, entry.size, seconds))
    }
  }

  private finalize(taskId: string, status: TaskStatus, error?: string): void {
    const task = this.tasks.get(taskId)
    if (!task) return
    task.status = status
    task.updated_at = this.now()
    if (error) task.error = String(error).slice(0, 300)
    if (!this.loggedEnd.has(taskId)) {
      this.loggedEnd.add(taskId)
      const doneFiles = Object.values(task.files).filter(file => file.size > 0 && file.downloaded >= file.size).length
      this.progress(formatTaskEnd(taskId, status, doneFiles, task.planned_files, this.queueSummary(taskId)))
    }
  }

  async parseLink(linkId: string, force = false): Promise<Record<string, unknown>> {
    const link = await this.links.get(linkId)
    if (!link) throw new PikpakError(`分享链接不存在：${linkId}`)

    let title = ''
    let fileNum: number | null = null
    let truncated = false
    let nodes: unknown[] = []
    let parsedAt: string | null = null

    const cached = force ? null : await this.links.getParseCache(linkId)
    if (cached) {
      title = cached.cache.title
      fileNum = cached.cache.file_num
      truncated = cached.cache.truncated
      nodes = cached.cache.nodes
      parsedAt = cached.parsedAt
    } else {
      const accountId = await this.accounts.choose(new Set(), undefined, false)
      if (!accountId) throw new PikpakError('没有可用账号；请先登录')
      const client = await this.accounts.clientFor(accountId)
      await client.ensureSession()
      const walked = await client.walkShare(link.share_id, link.pass_code, 20000, link.root_id)
      title = String(walked.title ?? '')
      fileNum = walked.file_num != null ? Number(walked.file_num) : null
      truncated = Boolean(walked.truncated)
      nodes = walked.nodes as unknown[]
      const cache = { title, file_num: fileNum, truncated, nodes }
      parsedAt = await this.links.setParseCache(linkId, cache)
    }

    await this.markDownloaded(nodes, link)

    return { link_id: linkId, title, file_num: fileNum, truncated, nodes, parsed_at: parsedAt }
  }

  /** 读对应系列的 state.json，给每个文件节点标记「是否已下载」与「文件是否真实存在」。 */
  private async markDownloaded(nodes: unknown[], link: PikpakLink): Promise<void> {
    const seriesRoot = path.join(this.destDir, link.folder)
    const statePath = path.join(seriesRoot, '.pikpakget', 'state.json')
    let data: { files?: Record<string, { state?: string, local?: string | null }> } | null = null
    try {
      data = JSON.parse(await readFile(statePath, 'utf8'))
    } catch {
      return
    }
    const files = data?.files ?? {}
    for (const raw of nodes) {
      const node = raw as PikpakNode
      if (node.is_folder) continue
      const record = files[`${link.url}\t${node.id}`]
      node.downloaded = record?.state === 'done'
      node.exists = record?.state === 'done'
        ? Boolean(record.local && existsSync(path.join(seriesRoot, record.local)))
        : false
    }
  }

  /** 删除指定文件的已下载记录（重置为未下载），返回删除条数。 */
  async resetRecords(linkId: string, fileIds: string[]): Promise<number> {
    const link = await this.links.get(linkId)
    if (!link) throw new PikpakError(`分享链接不存在：${linkId}`)
    const statePath = path.join(this.destDir, link.folder, '.pikpakget', 'state.json')
    let data: { files?: Record<string, Record<string, unknown>> } | null = null
    try {
      data = JSON.parse(await readFile(statePath, 'utf8'))
    } catch {
      return 0
    }
    const files = data?.files ?? {}
    const wanted = new Set(fileIds)
    let count = 0
    for (const [key, record] of Object.entries(files)) {
      if (wanted.has(String(record.source_id ?? ''))) {
        delete files[key]
        count += 1
      }
    }
    if (count > 0) {
      await mkdir(path.dirname(statePath), { recursive: true })
      await writeFile(statePath, `${JSON.stringify(data, null, 1)}\n`, 'utf8')
    }
    return count
  }

  /** 导出引擎数据（账号库密文 + 链接库 + 主密钥），用于本机↔NAS 迁移。 */
  async exportData(): Promise<Record<string, unknown>> {
    const files: Record<string, string> = {}
    const readText = async (filePath: string): Promise<string> => {
      try {
        return await readFile(filePath, 'utf8')
      } catch {
        return ''
      }
    }

    const accountsJson = await readText(path.join(this.configDir, 'accounts.json'))
    if (accountsJson) files['accounts.json'] = accountsJson
    const linksJson = await readText(path.join(this.configDir, 'links.json'))
    if (linksJson) files['links.json'] = linksJson

    const accountsDir = path.join(this.configDir, 'accounts')
    try {
      const entries = await readdir(accountsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        for (const name of ['session.edt', 'device_id.edt']) {
          const content = await readText(path.join(accountsDir, entry.name, name))
          if (content) files[`accounts/${entry.name}/${name}`] = content
        }
      }
    } catch {
      // 无 accounts 目录
    }

    return {
      format: 'pikpak-get-export',
      version: 1,
      masterKey: this.masterKey,
      files,
      exportedAt: new Date().toISOString(),
    }
  }

  /** 导入引擎数据（写回 config 目录的密文文件）；masterKey 存在时写 <config>/master.key 供下次启动采用。 */
  async importData(files: Record<string, string>, masterKey?: string): Promise<number> {
    let count = 0
    for (const [rel, content] of Object.entries(files)) {
      if (typeof content !== 'string') continue
      const segments = rel.split('/').filter(part => part && part !== '.' && part !== '..')
      if (segments.length === 0) throw new PikpakError('导入数据包含非法路径')
      const target = path.join(this.configDir, ...segments)
      if (!target.startsWith(this.configDir)) throw new PikpakError('导入数据包含越界路径')
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, content, 'utf8')
      count += 1
    }
    if (masterKey) {
      await writeFile(path.join(this.configDir, 'master.key'), masterKey, 'utf8')
    }
    return count
  }

  private async runTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    const flag = this.stopFlags.get(taskId)
    if (!task || !flag) return
    const link = await this.links.get(task.link_id)
    if (!link) {
      this.finalize(taskId, 'error', '分享链接不存在')
      return
    }
    task.status = 'running'
    task.updated_at = this.now()
    this.addLog(taskId, 'info', `开始下载：${link.url}`)
    this.progress(formatTaskStart(taskId, task.planned_files, task.planned_bytes, this.queueSummary(taskId)))

    const dest = task.dest || this.destDir
    const seriesRoot = `${dest}/${link.folder}`
    const args: PipelineArgs = {
      dest,
      seriesRoot,
      stateDir: `${seriesRoot}/.pikpakget`,
      connections: 1,
      gap: 20,
      repeat: 3,
      maxFiles: 0,
      skipExt: '',
      verify: false,
      noDelete: false,
    }
    const job = {
      url: link.url,
      share_id: link.share_id,
      pass_code: link.pass_code,
      folder: link.folder,
      root_id: link.root_id,
      order: 1,
      key: link.url,
    }
    const selected = task.file_ids ? new Set(task.file_ids) : null

    const logDir = `${seriesRoot}/.pikpakget`
    const logFile = path.join(logDir, `grab-${new Date().toISOString().slice(0, 10)}.log`)
    await mkdir(logDir, { recursive: true })
    const log = (message: string, level?: string): void => {
      const lvl = level ?? 'info'
      this.addLog(taskId, lvl, message)
      const line = `${new Date().toISOString()} ${lvl.toUpperCase().padEnd(4, ' ')} ${message}\n`
      void appendFile(logFile, line, 'utf8').catch(() => undefined)
    }
    const stop = (): boolean => flag.stopped || this.stop?.() === true
    const onProgress = (node: PikpakNode, written: number): void => this.setFileProgress(taskId, node, written)

    const excluded = new Set<string>()
    while (true) {
      if (stop()) {
        this.finalize(taskId, 'cancelled')
        return
      }
      const accountId = await this.accounts.choose(excluded, task.account_id ?? undefined, true)
      if (!accountId) {
        this.finalize(taskId, 'error', '没有可用账号（可能全部在流量冷却中）')
        return
      }
      let client
      try {
        client = await this.accounts.clientFor(accountId)
      } catch (error) {
        this.addLog(taskId, 'error', `账号初始化失败：${(error as Error).message}`)
        excluded.add(accountId)
        continue
      }
      this.addLog(taskId, 'info', `使用账号 ${accountId} 下载`)
      const pipeline = new Pipeline({
        args,
        client,
        log,
        stop,
        accountId,
        selectedFileIds: selected,
        // 勾选顺序 = 控制面传来的界面顺序，直接作为下载排队顺序
        selectedOrder: selected ? task.file_ids : null,
        onProgress,
      })
      let code: number
      try {
        code = await pipeline.run([job])
      } catch (error) {
        this.finalize(taskId, 'error', (error as Error).message)
        this.addLog(taskId, 'error', (error as Error).message)
        return
      }
      if (stop()) {
        this.finalize(taskId, 'cancelled')
        return
      }
      if (code === 4) {
        await this.accounts.markTrafficCapped(accountId)
        this.addLog(taskId, 'warn', `账号 ${accountId} 下行流量已满，1 小时后重试；尝试下一个账号`)
        excluded.add(accountId)
        continue
      }
      if (code === 0) {
        this.addLog(taskId, 'info', '任务完成')
        this.finalize(taskId, 'done')
      } else {
        this.addLog(taskId, 'warn', '仍有文件未完成；可重新发起任务续传（已完成文件会被跳过）')
        this.finalize(taskId, 'partial')
      }
      return
    }
  }
}
