import type { PikpakClient } from './api.ts'
// 下载流水线（TS 移植自 PikpakGet 的 pipeline.py 核心路径）：
// 转存 → 等就绪 → 下载 → hash 校验 → 清理云端，逐文件串行，支持选文件过滤与断点续传。
import { Buffer } from 'node:buffer'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MutationOutcomeUnknown, PikpakError, TrafficCapped } from './errors.ts'
import { downloadSegments, downloadStream, PIECE_SIZES, verifyContent } from './stream.ts'

const SPACE_HEADROOM = 400_000_000
const POLL_INTERVAL = 4
const POLL_TIMEOUT = 1800
const MAX_ATTEMPTS = 3
const QUARANTINE_SUFFIX = '.unverified'
const STATE_VERSION = 5

export interface PikpakNode {
  id: string
  name: string
  prefix: string
  parent_id: string
  path: string
  is_folder: boolean
  size: number
  child_count?: number
  hash: string | null
  mime: string
  downloaded?: boolean
  exists?: boolean
}

export interface PipelineArgs {
  dest: string
  seriesRoot: string
  stateDir: string
  connections: number
  gap: number
  repeat: number
  maxFiles: number
  skipExt: string
  verify: boolean
  noDelete: boolean
}

export interface PipelineOptions {
  args: PipelineArgs
  client: PikpakClient
  log: (message: string, level?: string) => void
  stop: () => boolean
  accountId?: string
  selectedFileIds?: Set<string> | null
  onProgress?: (node: PikpakNode, written: number, elapsed: number) => void
}

interface LinkState {
  status: string
  attempts: number
  order?: number
  folder?: string
  title?: string
  total_bytes?: number
  file_count?: number
  truncated?: boolean
  pending_files?: number
  error?: string
}

interface FileRecord {
  state: string
  attempts: number
  link_key: string | null
  restored_id: string | null
  source_id: string
  local: string | null
  home: string | null
  quarantined: string | null
  size: number
  seconds: number | null
  error: string | null
  verified_hash: string | null
  verified_mtime: number | null
  hash_piece?: number | null
  source_hash?: string | null
  account_id?: string | null
  restore_task_id?: unknown
  name?: string
  path?: string
}

interface StateData {
  version: number
  updated: string | null
  links: Record<string, LinkState>
  files: Record<string, FileRecord>
}

function fileKey(linkKey: string, fileId: string): string {
  return `${linkKey}\t${fileId}`
}

export function human(nbytes: number): string {
  let value = Number(nbytes) || 0
  let unit = 'B'
  for (const next of ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']) {
    unit = next
    if (Math.abs(value) < 1024 || next === 'PiB') break
    value /= 1024
  }
  return `${value.toFixed(1)}${unit}`
}

function clipBytes(text: string, limit: number): string {
  const encoded = Buffer.from(text, 'utf8')
  if (encoded.length <= limit) return text
  return encoded.subarray(0, limit).toString('utf8')
}

export function safeName(name: string, limit = 200): string {
  let text = String(name).replace(/[/\0]/g, '_').trim()
  text = text.replace(/\s+/g, ' ').trim()
  if (text === '.' || text === '..') text = `_${text}`
  if (text === '.pikpakget') text = `_${text}`
  text = text.replace(/^ +| +$/g, '')
  if (Buffer.byteLength(text, 'utf8') > limit) {
    const dot = text.lastIndexOf('.')
    if (dot > 0) {
      const ext = text.slice(dot)
      const stem = text.slice(0, dot)
      const keep = Math.max(limit - Buffer.byteLength(ext, 'utf8') - 9, 8)
      text = `${clipBytes(stem, keep)}….${ext}`
    } else {
      text = `${clipBytes(text, limit - 3)}…`
    }
  }
  return text || 'untitled'
}

export function parseSkipExt(text: string): Set<string> {
  const exts = new Set<string>()
  for (const part of (text || '').split(',')) {
    const ext = part.trim().replace(/^\./, '').toLowerCase()
    if (ext) exts.add(ext)
  }
  return exts
}

async function sizeOnDisk(filePath: string | null): Promise<number | null> {
  if (!filePath) return null
  try {
    const info = await stat(filePath)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}

// ----------------------------------------------------------------------- State
export class State {
  readonly path: string | null
  readonly root: string | null
  data: StateData

  constructor(statePath: string | null, root: string | null = null, readOnly = false) {
    this.path = statePath
    this.root = root ? path.resolve(root) : null
    this.data = { version: STATE_VERSION, updated: null, links: {}, files: {} }
    if (statePath && existsSync(statePath)) {
      let loaded: StateData
      try {
        loaded = JSON.parse(readFileSync(statePath, 'utf8')) as StateData
      } catch (error) {
        if (readOnly) throw new PikpakError(`状态文件读不了：${statePath}（${(error as Error).message}）`)
        const backup = `${statePath}.corrupt-${Date.now()}`
        try {
          copyFileSync(statePath, backup)
        } catch { /* ignore */ }
        loaded = { version: STATE_VERSION, updated: null, links: {}, files: {} }
      }
      if (!loaded || loaded.version !== STATE_VERSION) {
        throw new PikpakError(`状态版本不受支持：${statePath}；请自行移走旧文件后重跑`)
      }
      if (typeof loaded.links !== 'object' || typeof loaded.files !== 'object') {
        throw new PikpakError(`状态结构不完整：${statePath}；请先检查文件`)
      }
      if (this.root) {
        for (const record of Object.values(loaded.files)) {
          record.local = this._absolute(record.local)
          record.home = this._absolute(record.home)
          record.quarantined = this._absolute(record.quarantined)
        }
      }
      this.data = loaded
    }
  }

  private _absolute(value: string | null): string | null {
    if (value === null || value === undefined) return null
    if (path.isAbsolute(value)) throw new PikpakError(`进度文件包含非相对路径：${this.path}`)
    const abs = path.resolve(this.root!, value)
    if (!abs.startsWith(this.root!)) throw new PikpakError(`进度文件路径超出系列目录：${this.path}`)
    return abs
  }

  private _relative(value: string | null): string | null {
    if (value === null || value === undefined) return null
    const abs = path.resolve(value)
    if (!abs.startsWith(this.root!)) throw new PikpakError(`本地文件路径超出系列目录：${abs}`)
    return path.relative(this.root!, abs).split(path.sep).join('/')
  }

  link(linkKey: string): LinkState {
    return this.data.links[linkKey] ??= { status: 'pending', attempts: 0 }
  }

  file(fileId: string, linkKey: string | null): FileRecord {
    const key = linkKey !== null ? fileKey(linkKey, fileId) : fileId
    if (linkKey === null && !this.data.files[key]) {
      const matches = Object.values(this.data.files).filter(rec => rec.source_id === fileId)
      if (matches.length === 1) return matches[0]!
    }
    return this.data.files[key] ??= {
      state: 'pending',
      attempts: 0,
      link_key: linkKey,
      restored_id: null,
      source_id: fileId,
      local: null,
      home: null,
      quarantined: null,
      size: 0,
      seconds: null,
      error: null,
      verified_hash: null,
      verified_mtime: null,
    }
  }

  filesOf(linkKey: string): FileRecord[] {
    return Object.values(this.data.files).filter(rec => rec.link_key === linkKey)
  }

  resetTransientFailures(): void {
    for (const record of Object.values(this.data.files)) {
      if (record.state === 'failed' || record.state === 'retry') {
        record.state = 'pending'
        record.attempts = 0
      }
    }
    for (const info of Object.values(this.data.links)) {
      if (info.status === 'error') {
        info.status = 'pending'
        info.attempts = 0
      }
    }
  }

  async save(): Promise<void> {
    if (!this.path) return
    await mkdir(path.dirname(this.path), { recursive: true })
    this.data.updated = new Date().toISOString()
    let serialized: StateData = this.data
    if (this.root) {
      serialized = { ...this.data, files: {} }
      for (const [key, record] of Object.entries(this.data.files)) {
        serialized.files[key] = {
          ...record,
          local: this._relative(record.local),
          home: this._relative(record.home),
          quarantined: this._relative(record.quarantined),
        }
      }
    }
    const tmp = `${this.path}.tmp`
    await writeFile(tmp, `${JSON.stringify(serialized, null, 1)}\n`, 'utf8')
    await rename(tmp, this.path)
  }
}

// --------------------------------------------------------------------- Pipeline
export class Pipeline {
  readonly args: PipelineArgs
  readonly client: PikpakClient
  readonly log: (message: string, level?: string) => void
  readonly stop: () => boolean
  readonly accountId?: string
  readonly selectedFileIds: Set<string> | null
  readonly onProgress?: (node: PikpakNode, written: number, elapsed: number) => void
  readonly state: State
  private created = new Set<string>()
  private usedNames = new Map<string, string>()
  private skipExt: Set<string>
  filesDone = 0
  bytesDone = 0
  trafficCapped = false
  private hashHint: number | null = null
  private throttleHits = 0
  private authHits = 0

  constructor(options: PipelineOptions) {
    this.args = options.args
    this.client = options.client
    this.log = options.log
    this.stop = options.stop
    this.accountId = options.accountId
    this.selectedFileIds = options.selectedFileIds ?? null
    this.onProgress = options.onProgress
    this.state = new State(
      options.args.stateDir ? path.join(options.args.stateDir, 'state.json') : null,
      options.args.seriesRoot || null,
    )
    this.skipExt = parseSkipExt(options.args.skipExt)
    for (const record of Object.values(this.state.data.files)) {
      if (record.restored_id && record.state !== 'done' && record.state !== 'too_big'
        && (!this.accountId || record.account_id === this.accountId)) {
        this.created.add(record.restored_id)
      }
      if (record.local) {
        this.usedNames.set(this.nameKey(path.dirname(record.local), path.basename(record.local)), record.source_id || record.path || '')
      }
    }
  }

  private nameKey(dir: string, name: string): string {
    return `${dir}\u0000${name.toLowerCase()}`
  }

  async space(): Promise<{ limit: number, usage: number, in_trash: number, free: number }> {
    return this.client.space()
  }

  async waitSpaceFreed(expectDrop: number, before?: number, timeout = 150): Promise<ReturnType<Pipeline['space']> | null> {
    const floor = Math.max((before ?? 0) - expectDrop, 0)
    const tolerance = Math.max(expectDrop * 0.02, 2_000_000)
    const deadline = Date.now() + timeout * 1000
    while (Date.now() < deadline) {
      if (this.stop()) return null
      const space = await this.space()
      if (space.usage <= floor + tolerance) return space
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 1000))
    }
    return this.space()
  }

  async waitGap(seconds: number): Promise<boolean> {
    const deadline = Date.now() + seconds * 1000
    while (!this.stop()) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return false
      await new Promise(resolve => setTimeout(resolve, Math.min(200, remaining)))
    }
    return true
  }

  // ----------------------------------------------------------------- planning
  async inventory(job: Record<string, unknown>): Promise<Record<string, unknown>> {
    const walked = await this.client.walkShare(
      String(job.share_id),
      String(job.pass_code ?? ''),
      20000,
      String(job.root_id ?? ''),
    )
    const allNodes = walked.nodes as PikpakNode[]
    let files = allNodes.filter(node => !node.is_folder)
    let skipped = 0
    if (this.skipExt.size) {
      const kept = files.filter((node) => {
        const ext = path.extname(node.name).replace(/^\./, '').toLowerCase()
        if (this.skipExt.has(ext)) {
          skipped += 1
          return false
        }
        return true
      })
      files = kept
    }
    return {
      title: String(walked.title ?? ''),
      token: String(walked.pass_code_token ?? ''),
      files,
      total: files.reduce((sum, node) => sum + node.size, 0),
      folder_nodes: allNodes.filter(node => node.is_folder),
      skipped,
      truncated: Boolean(walked.truncated),
    }
  }

  // ------------------------------------------------------------- one file step
  async reuseOrRestore(job: Record<string, unknown>, node: PikpakNode, record: FileRecord, token: string): Promise<string> {
    let restored = record.restored_id
    if (this.accountId && record.account_id !== this.accountId) {
      restored = null
      record.restored_id = null
    }
    if (restored) {
      let exact = false
      try {
        const info = await this.client.file(restored)
        exact = info.kind === 'drive#file' && Number(info.size ?? 0) === node.size && !info.trashed
      } catch { exact = false }
      if (exact) {
        this.created.add(restored)
        return restored
      }
      await this.forget([restored], node.size)
      record.restored_id = null
    }
    return this.restoreOne(job, node, record, token)
  }

  async restoreOne(job: Record<string, unknown>, node: PikpakNode, record: FileRecord, token: string): Promise<string> {
    if (!this.args.seriesRoot) throw new PikpakError('没有网盘临时目录，停止转存')
    const workspace = await this.client.prepareWorkspace()
    const before = new Set((await this.client.listFolder(workspace)).map(item => String(item.id)))
    const made = await this.client.restore(String(job.share_id), token, [node.id], workspace)
    record.restore_task_id = made.restore_task_id
    const status = String(made.restore_status ?? '')
    if (status.toUpperCase().includes('FAIL') || status.toUpperCase().includes('ERROR')) {
      throw new PikpakError(`转存被拒: ${status} ${JSON.stringify(made).slice(0, 200)}`)
    }

    const deadline = Date.now() + POLL_TIMEOUT * 1000
    while (true) {
      if (this.stop()) throw new PikpakError('已中断（云端副本与本地进度已保留）')
      const candidates = (await this.client.listFolder(workspace)).filter((item) => {
        if (before.has(String(item.id)) || item.kind !== 'drive#file' || item.trashed) return false
        if (node.size && Number(item.size ?? 0) !== node.size) return false
        if (node.hash && item.hash && String(item.hash).toUpperCase() !== node.hash.toUpperCase()) return false
        return true
      })
      if (candidates.length > 1) throw new PikpakError('临时目录出现多个同大小的新文件，无法确认转存副本')
      if (candidates.length === 1) {
        const restored = String(candidates[0]!.id)
        this.created.add(restored)
        record.restored_id = restored
        record.account_id = this.accountId ?? null
        await this.state.save()
        return restored
      }
      if (Date.now() > deadline) throw new PikpakError(`转存后 ${POLL_TIMEOUT / 60} 分钟内没看到新文件`)
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL * 1000))
    }
  }

  async waitReady(fileId: string, expectSize: number): Promise<Record<string, unknown>> {
    const deadline = Date.now() + POLL_TIMEOUT * 1000
    while (Date.now() < deadline) {
      if (this.stop()) throw new PikpakError('已中断（云端副本与本地进度已保留）')
      const info = await this.client.file(fileId)
      const phase = String(info.phase ?? '')
      const size = Number(info.size ?? 0)
      if (phase.toUpperCase().includes('FAIL')) throw new PikpakError(`云端文件状态异常 ${phase}`)
      if (phase.endsWith('COMPLETE') || (expectSize && size === expectSize)) {
        if (expectSize && size && size !== expectSize) throw new PikpakError(`云端文件大小不符 ${size} != ${expectSize}`)
        return info
      }
      if (await this.waitGap(POLL_INTERVAL)) throw new PikpakError('已中断（云端副本与本地进度已保留）')
    }
    throw new PikpakError('等待云端文件就绪超时')
  }

  destPath(node: PikpakNode, destDir: string): string {
    let name = safeName(node.name)
    const identity = node.id || node.path
    const taken = this.usedNames.get(this.nameKey(destDir, name))
    if (taken && taken !== identity) {
      const parent = node.path.includes('/') ? node.path.split('/').slice(-2, -1)[0] ?? '' : ''
      name = safeName(parent ? `${parent} - ${node.name}` : node.path)
      let bump = 2
      while (this.usedNames.get(this.nameKey(destDir, name)) && this.usedNames.get(this.nameKey(destDir, name)) !== identity) {
        const dot = name.lastIndexOf('.')
        name = dot > 0 ? `${name.slice(0, dot)} (${bump}).${name.slice(dot + 1)}` : `${name} (${bump})`
        bump += 1
      }
    }
    this.usedNames.set(this.nameKey(destDir, name), identity)
    return path.join(destDir, name)
  }

  async ensureLocalDir(target: string): Promise<void> {
    const base = path.resolve(this.args.dest)
    const resolved = path.resolve(target)
    if (!resolved.startsWith(base)) throw new PikpakError(`目标目录越出下载库：${target}`)
    await mkdir(resolved, { recursive: true })
  }

  async fetchTo(fileId: string, node: PikpakNode, destDir: string, record: FileRecord | null): Promise<[string, string]> {
    const final = this.destPath(node, destDir)

    const report = (written: number, elapsed: number): void => {
      this.onProgress?.(node, written, elapsed)
    }

    let local: string
    let how: string
    try {
      const part = `${final}.part`
      if (this.args.connections > 1 && node.size) {
        const got = await downloadSegments(
          () => this.client.downloadUrl(fileId).then(d => d.url),
          part,
          node.size,
          this.args.connections,
          { fetchImpl: this.client.fetchImpl, stop: this.stop, onProgress: report },
        )
        if (got !== node.size) throw new PikpakError(`拼装后大小不符 ${got}/${node.size}`)
        local = part
        how = 'transfer-ready'
      } else {
        const resume = (await sizeOnDisk(part)) ?? 0
        const { url } = await this.client.downloadUrl(fileId)
        const written = await downloadStream(url, part, node.size, resume, {
          fetchImpl: this.client.fetchImpl,
          stop: this.stop,
          onProgress: report,
        })
        if (node.size && written !== node.size) throw new PikpakError(`下载不完整 ${written}/${node.size}`)
        local = part
        how = 'transfer-ready'
      }
    } catch (error) {
      if (error instanceof PikpakError && error.transient) throw error
      throw error
    }

    if (how === 'transfer-ready') {
      return [await this.promote(local, final, node, record), 'downloaded']
    }
    return [local, how]
  }

  async existingMatches(filePath: string, node: PikpakNode, record: FileRecord | null): Promise<boolean> {
    const size = await sizeOnDisk(filePath)
    if (size !== node.size) return false
    if (!this.args.verify) return true
    if (!node.hash) return true
    if (record && record.verified_hash === node.hash && record.verified_mtime && record.hash_piece) {
      try {
        const info = await stat(filePath)
        if (record.verified_mtime === Math.round(info.mtimeMs * 1e6)) return true
      } catch { return false }
    }
    const piece = await verifyContent(filePath, node.hash, record?.hash_piece ? [record.hash_piece, ...PIECE_SIZES.filter(s => s !== record.hash_piece)] : PIECE_SIZES)
    if (piece === null) return false
    if (record) {
      record.hash_piece = piece
      record.verified_hash = node.hash
      try {
        const info = await stat(filePath)
        record.verified_mtime = Math.round(info.mtimeMs * 1e6)
      } catch { /* ignore */ }
    }
    return true
  }

  async promote(part: string, final: string, node: PikpakNode, record: FileRecord | null): Promise<string> {
    const expected = node.hash
    if (expected) {
      const piece = await verifyContent(part, expected, this.hashHint ? [this.hashHint, ...PIECE_SIZES.filter(s => s !== this.hashHint)] : PIECE_SIZES)
      if (piece === null) {
        const reason = `云端 ${expected.slice(0, 16)}… 无候选分片命中`
        if (record && record.attempts >= MAX_ATTEMPTS) {
          return this.quarantine(part, reason, record, final)
        }
        await rm(part, { force: true })
        throw new PikpakError(`内容 hash 与云端不符（${reason}），丢弃重下`)
      }
      if (record) record.hash_piece = piece
      this.hashHint = piece
    }
    await rename(part, final)
    if (expected && record) {
      try {
        const info = await stat(final)
        record.verified_hash = expected
        record.verified_mtime = Math.round(info.mtimeMs * 1e6)
      } catch { /* ignore */ }
    }
    return final
  }

  async quarantine(filePath: string, reason: string, record: FileRecord | null, home: string): Promise<string> {
    let doomed = `${home}${QUARANTINE_SUFFIX}`
    if (existsSync(doomed)) doomed = `${doomed}-${Date.now()}`
    await rename(filePath, doomed)
    if (record) {
      record.state = 'unverified'
      record.local = doomed
      record.home = home
      record.quarantined = doomed
      record.hash_piece = null
      record.verified_hash = null
      record.verified_mtime = null
      record.error = reason.slice(0, 300)
    }
    this.log(`内容核对不过（${reason}），字节保留为 ${path.basename(doomed)}`, 'error')
    return doomed
  }

  async forget(ids: string[], size = 0): Promise<void> {
    const mine = ids.filter(id => id && this.created.has(id))
    if (!mine.length || this.args.noDelete) return
    const before = this.stop() ? null : (await this.space()).usage
    await this.client.cleanup(mine)
    for (const id of mine) this.created.delete(id)
    if (before !== null && !this.stop()) {
      await this.waitSpaceFreed(size, before)
    }
  }

  /** 连续限流 / 连续 401/403 / 会话失效时，判断是否该停本轮（对应 Python 的 note_throttle）。 */
  private noteThrottle(error: unknown): boolean {
    if (!(error instanceof PikpakError)) return false
    if (this.client.sessionDead) {
      this.log('会话续期被服务器拒绝，停止本轮：请重新登录后重跑', 'error')
      return true
    }
    if (error instanceof TrafficCapped) {
      this.trafficCapped = true
      return true
    }
    const status = error.status
    if (error.throttled || status === 429 || status === 503) {
      this.throttleHits += 1
      if (this.throttleHits >= 3) {
        this.log('连续 3 次被限流，停止本轮以免触发风控；请至少 1 小时后再重跑', 'error')
        return true
      }
      return false
    }
    if (status === 401 || status === 403) {
      this.authHits += 1
      if (this.authHits >= 3) {
        this.log('连续 3 次 HTTP 401/403 被拒，更像会话或账号问题；请重新登录后重跑', 'error')
        return true
      }
      this.log(`HTTP ${status} 被拒，按本链接不可用处理后继续（连续第 ${this.authHits}/3 次）`, 'warn')
      return false
    }
    return false
  }

  async reclaimWorkspace(needed: number): Promise<boolean> {
    // 引擎单进程、自动化：清理 Pack From Shared 全部项目（对应 CLI 的 -y）。
    const workspace = await this.client.prepareWorkspace()
    const items = await this.client.listFolder(workspace)
    if (!items.length) return false
    const ids = items.map(item => String(item.id))
    const before = (await this.space()).usage
    await this.client.cleanup(ids)
    for (const id of ids) this.created.delete(id)
    for (const record of Object.values(this.state.data.files)) {
      if (record.account_id === this.accountId && record.restored_id && ids.includes(record.restored_id)) {
        record.restored_id = null
      }
    }
    await this.state.save()
    await this.waitSpaceFreed(items.reduce((sum, item) => sum + Number(item.size ?? 0), 0), before)
    const left = (await this.client.listFolder(workspace)).filter(item => ids.includes(String(item.id)))
    if (left.length) throw new PikpakError(`Pack From Shared 清理后仍有 ${left.length} 项`)
    return (await this.space()).free >= needed
  }

  // ----------------------------------------------------------------- runLink
  async runLink(job: Record<string, unknown>): Promise<string> {
    const key = String(job.key ?? job.url)
    const link = this.state.link(key)
    link.order = Number(job.order ?? 0)
    link.folder = String(job.folder ?? '')

    let report: Record<string, unknown>
    try {
      report = await this.inventory(job)
    } catch (error) {
      if (this.stop()) {
        link.status = 'partial'
        await this.state.save()
        return 'stopped'
      }
      if (error instanceof PikpakError && error.transient && error.replaySafe) {
        link.status = 'retry'
        link.error = (error as Error).message.slice(0, 300)
        await this.state.save()
        return 'retry'
      }
      link.status = 'error'
      link.error = (error as Error).message.slice(0, 300)
      link.attempts += 1
      await this.state.save()
      return 'error'
    }

    this.authHits = 0
    let files = (report.files as PikpakNode[]).sort((a, b) => a.size - b.size)
    if (this.selectedFileIds) {
      files = files.filter(node => this.selectedFileIds!.has(node.id))
    }
    link.status = 'active'
    link.folder = String(job.folder ?? '')
    link.title = String(report.title ?? '')
    link.total_bytes = Number(report.total ?? 0)
    link.file_count = files.length
    link.truncated = Boolean(report.truncated)
    await this.state.save()

    const destDir = path.join(this.args.dest, String(job.folder ?? ''))
    const folderNodes = report.folder_nodes as PikpakNode[]
    const folderPaths = new Map<string, string>([['', destDir]])
    for (const folder of folderNodes) {
      const parent = folderPaths.get(folder.parent_id ?? '')
      if (!parent) throw new PikpakError(`分享文件夹缺少父目录：${folder.name.slice(0, 60)}`)
      folderPaths.set(folder.id, this.destPath(folder, parent))
    }
    for (const dir of folderPaths.values()) {
      try {
        await this.ensureLocalDir(dir)
      } catch (error) {
        link.status = 'error'
        link.error = `建立本地目录失败：${(error as Error).message}`
        await this.state.save()
        return 'error'
      }
    }

    for (let position = 0; position < files.length; position += 1) {
      const node = files[position]!
      if (this.stop()) {
        link.status = 'partial'
        await this.state.save()
        return 'stopped'
      }
      const record = this.state.file(node.id, key)
      // 记录驱动：已下载即判定完成，不检查文件位置（文件被移动/删除也信任记录，靠「删除记录」纠正）
      if (record.state === 'done') {
        continue
      }
      const parentDir = folderPaths.get(node.parent_id ?? '')
      if (!parentDir) {
        link.status = 'error'
        link.error = `文件缺少父目录：${node.path}`
        await this.state.save()
        return 'error'
      }
      const plannedLocal = this.destPath(node, parentDir)
      if (record.local !== plannedLocal && !(record.state === 'unverified' && record.home === plannedLocal)) {
        record.state = 'pending'
        record.local = plannedLocal
        record.home = plannedLocal
        record.quarantined = null
        record.verified_hash = null
        record.verified_mtime = null
      }
      record.source_hash = node.hash
      record.name = node.name
      record.size = node.size
      record.path = node.path
      record.local = record.local || plannedLocal

      if (await this.existingMatches(plannedLocal, node, record)) {
        if (record.state === 'done') continue
        await this.forget([record.restored_id ?? ''], node.size)
        record.local = plannedLocal
        record.home = plannedLocal
        record.state = 'done'
        record.error = null
        await this.state.save()
        continue
      }
      if (record.state === 'done' || record.state === 'downloaded') record.state = 'pending'

      if (!record.restored_id || record.account_id !== this.accountId) {
        record.restored_id = null
      }

      const space = await this.space()
      const needed = node.size + SPACE_HEADROOM
      if (space.limit && space.free < needed && record.restored_id) {
        // 已有云端副本时不强制回收；先尝试续用
      } else if (space.limit && space.free < needed) {
        const reclaimed = await this.reclaimWorkspace(needed)
        if (!reclaimed) {
          record.state = 'failed'
          record.error = '云盘空间不足，当前文件无法转存'
          link.status = 'partial'
          await this.state.save()
          continue
        }
      }

      if (this.filesDone && this.args.gap) {
        if (await this.waitGap(this.args.gap)) {
          link.status = 'partial'
          await this.state.save()
          return 'stopped'
        }
      }
      if (this.stop()) {
        link.status = 'partial'
        await this.state.save()
        return 'stopped'
      }

      const started = Date.now()
      record.state = 'restoring'
      record.attempts += 1
      await this.state.save()
      try {
        const restored = await this.reuseOrRestore(job, node, record, String(report.token ?? ''))
        await this.waitReady(restored, node.size)
        const [local, how] = await this.fetchTo(restored, node, parentDir, record)
        if (how === 'unverified') {
          await this.forget([restored], node.size)
          this.filesDone += 1
          await this.state.save()
          continue
        }
        record.state = 'downloaded'
        record.local = local
        record.seconds = Math.round((Date.now() - started) / 10) / 100
        await this.state.save()
        await this.forget([restored], node.size)
        record.state = 'done'
        record.error = null
        if (record.quarantined && existsSync(record.quarantined)) {
          await rm(record.quarantined, { force: true })
        }
        record.quarantined = null
        await this.state.save()
        this.filesDone += 1
        this.bytesDone += node.size
        this.throttleHits = 0
      } catch (error) {
        if (error instanceof MutationOutcomeUnknown) {
          record.attempts = Math.max(record.attempts - 1, 0)
          record.state = 'retry'
          record.error = (error as Error).message.slice(0, 300)
          await this.state.save()
          return 'throttled'
        }
        if (this.stop()) {
          record.state = 'retry'
          record.error = (error as Error).message.slice(0, 300)
          link.status = 'partial'
          await this.state.save()
          return 'stopped'
        }
        if (error instanceof PikpakError && error.transient) {
          record.attempts = Math.max(record.attempts - 1, 0)
          record.state = 'retry'
          record.error = (error as Error).message.slice(0, 300)
          link.status = 'retry'
          await this.state.save()
          return 'retry'
        }
        if (error instanceof TrafficCapped) {
          record.attempts = Math.max(record.attempts - 1, 0)
          record.state = 'pending'
          this.trafficCapped = true
          record.error = (error as Error).message.slice(0, 300)
          link.status = 'partial'
          await this.state.save()
          return 'throttled'
        }
        record.state = record.attempts >= MAX_ATTEMPTS ? 'failed' : 'retry'
        record.error = (error as Error).message.slice(0, 300)
        link.status = 'partial'
        await this.state.save()
        try {
          await this.forget([record.restored_id ?? ''], node.size)
        } catch { /* ignore */ }
        if (this.noteThrottle(error)) return 'throttled'
        if (record.state === 'failed') continue
        return 'retry'
      }
    }

    const pending = files.filter((node) => {
      const rec = this.state.data.files[fileKey(key, node.id)]
      return !rec || (rec.state !== 'done' && rec.state !== 'too_big')
    })
    link.status = !pending.length && !report.truncated ? 'done' : 'incomplete'
    link.pending_files = pending.length
    await this.state.save()
    return pending.length ? 'incomplete' : 'ok'
  }

  async run(jobs: Record<string, unknown>[]): Promise<number> {
    await mkdir(this.args.dest, { recursive: true })
    this.state.resetTransientFailures()
    await this.state.save()

    for (let passNumber = 1; passNumber <= (this.args.repeat || 1); passNumber += 1) {
      let initialized = false
      let transientFailures = 0
      const tally: Record<string, number> = {}

      const tryInit = async (): Promise<void> => {
        if (jobs.length && this.accountId) {
          await this.client.prepareWorkspace()
        }
        const space = await this.space()
        this.log(`云盘 ${human(space.usage)}/${human(space.limit)} 已用 | 并发 ${this.args.connections} 段`)
        initialized = true
      }
      try {
        await tryInit()
      } catch (error) {
        if (!(error instanceof PikpakError) || !error.transient || !error.replaySafe) throw error
        transientFailures += 1
        this.log(`下载准备暂时失败，进度已保留：${(error as Error).message}`, 'warn')
      }

      if (initialized) {
        for (const job of jobs) {
          if (this.stop()) break
          this.log(`— 第${passNumber}轮 ${String(job.url)}`)
          const code = await this.runLink(job)
          tally[code] = (tally[code] ?? 0) + 1
          if (code === 'throttled' || this.stop()) break
        }
      }

      if (this.stop()) return 1
      if (tally.throttled) return this.trafficCapped ? 4 : 1

      const unfinished = jobs.filter(job => this.state.link(String(job.key ?? job.url)).status !== 'done')
      if (!unfinished.length) return 0
      if (transientFailures) {
        if (passNumber >= (this.args.repeat || 1)) break
        const delay = [5, 15, 45, 120, 240][Math.min(passNumber - 1, 4)]!
        this.log(`本轮有临时请求失败；${delay}s 后进入下一轮`, 'warn')
        if (await this.waitGap(delay)) return 1
        continue
      }
      this.log(`${unfinished.length} 个链接未完成，进入下一轮补齐`)
    }
    this.log('仍有链接未完成；重跑同一命令即可从断点继续', 'warn')
    return 1
  }
}
