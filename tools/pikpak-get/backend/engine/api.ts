// PikPak 网盘 API 客户端（TS 移植自 PikpakGet 的 api.py）。
// 纯 Node/标准库，fetch 通过构造注入：本机注入 Electron net.fetch（走系统代理），
// NAS 服务注入原生 fetch。会话与 device_id 由调用方（accounts.ts）持有并加密持久化。
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { MutationOutcomeUnknown, PikpakError, RestoreOutcomeUnknown, TrafficCapped } from './errors.ts'

export type PikpakFetch = (url: string, init?: RequestInit) => Promise<Response>
export type PikpakLogger = (message: string, level?: string) => void
export type PikpakStop = () => boolean

export interface PikpakSession {
  access_token: string
  refresh_token: string
  token_type: string
  sub: string
  expires_at: number
}

const USER_API = 'https://user.mypikpak.com'
const DRIVE_API = 'https://api-drive.mypikpak.com/drive'

// 公开应用客户端常量（非账号凭据）。
const CLIENT_ID = 'YNxT9w7GMdWvEOKa'
const CLIENT_SECRET = 'dbw2OtmVEeuUvIptb1Coyg'
const CLIENT_VERSION = '1.47.1'
const PACKAGE_NAME = 'com.pikcloud.pikpak'
const SDK_VERSION = '2.0.4.204000'

export const CLOUD_FOLDER_NAME = 'Pack From Shared'

const CAPTCHA_SALTS = [
  'Gez0T9ijiI9WCeTsKSg3SMlx',
  'zQdbalsolyb1R/',
  'ftOjr52zt51JD68C3s',
  'yeOBMH0JkbQdEFNNwQ0RI9T3wU/v',
  'BRJrQZiTQ65WtMvwO',
  'je8fqxKPdQVJiy1DM6Bc9Nb1',
  'niV',
  '9hFCW2R1',
  'sHKHpe2i96',
  'p7c5E6AcXQ/IJUuAEC9W6',
  '',
  'aRv9hjc9P+Pbn+u3krN6',
  'BzStcgE8qVdqjEH16l4',
  'SqgeZvL5j9zoHP95xWHt',
  'zVof5yaJkPe3VFpadPof',
]

const TOKEN_REFRESH_MARGIN = 900
const CAPTCHA_TTL = 240
const REQUEST_DEADLINE_MS = 120_000
const REQUEST_ATTEMPTS = 5
const NETWORK_RETRY_WAITS = [5, 15, 45, 120, 240]
const THROTTLE_BACKOFF = [30, 120, 480, 900]

const SHARE_ID_RE = /(?:mypikpak\.com|pickpackapp\.com|mypikpak\.net|pikpak\.me)\/s\/([\w-]{8,})/
const TRAFFIC_CAP_RE = /downstream traffic|has exceeded the limit/i

function str(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

function num(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function captchaSign(clientId: string, deviceId: string, timestamp?: number): [string, string] {
  const stamp = String(timestamp ?? Date.now())
  let state = `${clientId}${CLIENT_VERSION}${PACKAGE_NAME}${deviceId}${stamp}`
  for (const salt of CAPTCHA_SALTS) {
    state = createHash('md5').update(state + salt).digest('hex')
  }
  return [`1.${state}`, stamp]
}

export function parseShareUrl(text: string): { shareId: string, passCode: string } {
  const match = SHARE_ID_RE.exec(text || '')
  if (!match) throw new Error(`not a PikPak share link: ${(text || '').slice(0, 60)}`)
  const query = ((text || '').split('?')[1] ?? '').split('#')[0] ?? ''
  const params = new URLSearchParams(query)
  const passCode = params.get('password') ?? params.get('pass_code') ?? ''
  return { shareId: match[1]!, passCode }
}

export function decodeShareFileId(fileId: string, shareId: string): string {
  if (!fileId || !shareId || fileId.length === shareId.length) return fileId
  try {
    const body = Buffer.from(fileId.slice(0, -6), 'base64url')
    const key = Buffer.from(shareId.slice(0, -2), 'base64url')
    if (body.length !== key.length) return fileId
    const mixed = Buffer.alloc(body.length)
    for (let i = 0; i < body.length; i++) mixed[i] = body[i]! ^ key[i]!
    return mixed.toString('base64url') + fileId.slice(-6, -4)
  } catch {
    return fileId
  }
}

export function shareRootId(text: string): string {
  const match = SHARE_ID_RE.exec(text || '')
  if (!match) return ''
  const tail = ((text || '').slice(match.index! + match[0].length).split('?')[0] ?? '')
  const parts = tail.split('/').filter(Boolean)
  return parts.length ? decodeShareFileId(parts[parts.length - 1]!, match[1]!) : ''
}

function isFolder(item: Record<string, unknown>): boolean {
  return item.kind === 'drive#folder'
}

async function parseJsonBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function sleepInterruptible(ms: number, stop?: PikpakStop): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (stop?.()) throw new PikpakError('已中断（进度已保存）')
    const step = Math.min(500, deadline - Date.now())
    await new Promise(resolve => setTimeout(resolve, step))
  }
}

export interface PikpakClientOptions {
  fetchImpl?: PikpakFetch
  deviceId: string
  session?: PikpakSession
  logger?: PikpakLogger
  stop?: PikpakStop
  /** signIn / refresh 更新会话后回调（accounts.ts 用来加密落盘） */
  onSession?: (session: PikpakSession) => void
}

export class PikpakClient {
  readonly fetchImpl: PikpakFetch
  private readonly log: PikpakLogger
  private readonly stop: PikpakStop
  private readonly onSession?: (session: PikpakSession) => void
  private _captchas = new Map<string, [string, number]>()
  private sessionData: PikpakSession
  deviceId: string
  sessionDead = false

  constructor(options: PikpakClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init))
    this.log = options.logger ?? (() => {})
    this.stop = options.stop ?? (() => false)
    this.onSession = options.onSession
    this.deviceId = options.deviceId
    this.sessionData = options.session ?? {
      access_token: '',
      refresh_token: '',
      token_type: 'Bearer',
      sub: '',
      expires_at: 0,
    }
  }

  get session(): PikpakSession {
    return this.sessionData
  }

  private setSession(next: PikpakSession): void {
    this.sessionData = next
    this.onSession?.(next)
  }

  // ------------------------------------------------------------------ session
  async signIn(username: string, password: string): Promise<PikpakSession> {
    const signinUrl = `${USER_API}/v1/auth/signin`
    const metas = username.includes('@')
      ? { email: username }
      : /^\d+$/.test(username)
        ? { phone_number: username }
        : { username }

    const { status, body } = await this._raw('POST', `${USER_API}/v1/shield/captcha/init`, {
      jsonBody: { client_id: CLIENT_ID, action: `POST:${signinUrl}`, device_id: this.deviceId, meta: metas },
      headers: this._clientHeaders(),
    }, false)
    const token = status === 200 ? str(body.captcha_token) : ''
    if (!token) {
      if (body.url) throw new PikpakError('登录需要先通过人工验证码（浏览器完成一次后再试）', { status, action: 'signin' })
      throw new PikpakError(`无法取得登录验证码: ${this._safeBody(body)}`, { status, action: 'signin' })
    }

    const result = await this._raw('POST', signinUrl, {
      form: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        username,
        password,
        captcha_token: token,
      },
      headers: { ...this._clientHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
    }, false)

    if (result.status !== 200 || !result.body.access_token) {
      const detail = str(result.body.error_description || result.body)
      let hint = ''
      if (detail.toLowerCase().includes('verification')) {
        hint = '（若反复出现 verification failed：连错会要求人工校验，请等几分钟再试或先登录一次官方客户端）'
      } else if (detail.toLowerCase().includes('prohibit')) {
        hint = '（服务端拒绝的是"登录"这个动作本身，不代表密码错。先试换一个出口地址；别连续重试，那可能升级成真风控。）'
      }
      throw new PikpakError(`登录失败: ${detail}${hint}\n服务端原文: ${this._safeBody(result.body)}`, { status: result.status, action: 'signin' })
    }

    const record = this._tokenRecord(result.body)
    record.sub = record.sub || this.sessionData.sub
    this.setSession(record)
    return record
  }

  async refresh(): Promise<void> {
    if (!this.sessionData.refresh_token) {
      this.sessionDead = true
      throw new PikpakError('会话没有 refresh_token，请重新登录', { action: 'refresh' })
    }
    const { status, body } = await this._raw('POST', `${USER_API}/v1/auth/token`, {
      jsonBody: {
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: this.sessionData.refresh_token,
      },
      headers: this._clientHeaders(),
    }, false)
    if (status !== 200 || !body.access_token) {
      this.sessionDead = status === 400 || status === 401 || status === 403
      const hint = this.sessionDead ? '（请重新登录）' : '（登录状态已保留）'
      throw new PikpakError(`会话续期失败: ${str(body.error_description || body)}${hint}`, { status, action: 'refresh' })
    }
    const record = this._tokenRecord(body)
    record.sub = record.sub || this.sessionData.sub
    this.setSession(record)
    this.sessionDead = false
    this.log('会话已自动续期')
  }

  async ensureSession(force = false): Promise<string> {
    if (!this.sessionData.access_token) {
      throw new PikpakError('还没有登录会话；请先登录', { action: 'session' })
    }
    if (force || this.sessionData.expires_at - Date.now() / 1000 <= TOKEN_REFRESH_MARGIN) {
      await this.refresh()
    }
    return this.sessionData.access_token
  }

  private _tokenRecord(body: Record<string, unknown>): PikpakSession {
    return {
      access_token: str(body.access_token),
      refresh_token: str(body.refresh_token),
      token_type: str(body.token_type) || 'Bearer',
      sub: str(body.sub),
      expires_at: Date.now() / 1000 + (num(body.expires_in) || 7200),
    }
  }

  // ------------------------------------------------------------------ plumbing
  private _clientHeaders(): Record<string, string> {
    return {
      'x-client-id': CLIENT_ID,
      'x-device-id': this.deviceId,
      'x-client-version': CLIENT_VERSION,
      'x-sdk-version': SDK_VERSION,
      'x-protocol-version': '301',
      'User-Agent': `${PACKAGE_NAME}/${CLIENT_VERSION}`,
    }
  }

  private _safeBody(body: Record<string, unknown>): string {
    const kept: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body || {})) {
      if (key.toLowerCase().includes('token') || ['captcha_vid', 'nonce', 'captcha_sign'].includes(key)) {
        kept[key] = '…省略…'
      } else if (typeof value === 'string' && value.length > 200) {
        kept[key] = `${value.slice(0, 200)}…`
      } else {
        kept[key] = value
      }
    }
    return JSON.stringify(kept)
  }

  private async _raw(
    method: string,
    url: string,
    options: {
      params?: Record<string, unknown>
      jsonBody?: unknown
      form?: Record<string, string>
      headers?: Record<string, string>
    } = {},
    auth = true,
  ): Promise<{ status?: number, body: Record<string, unknown> }> {
    let target = url
    if (options.params) {
      const search = new URLSearchParams()
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined && value !== null) search.set(key, String(value))
      }
      const qs = search.toString()
      if (qs) target += (target.includes('?') ? '&' : '?') + qs
    }

    let data: string | undefined
    if (options.form) {
      data = new URLSearchParams(options.form).toString()
    } else if (options.jsonBody !== undefined) {
      data = JSON.stringify(options.jsonBody)
    }

    const base: Record<string, string> = {
      ...this._clientHeaders(),
      'Content-Type': 'application/json',
      ...(auth && this.sessionData.access_token ? { Authorization: `Bearer ${this.sessionData.access_token}` } : {}),
    }
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries({ ...base, ...(options.headers ?? {}) })) {
      if (value !== undefined) headers[key] = value
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_DEADLINE_MS)
    try {
      const res = await this.fetchImpl(target, { method, headers, body: data, signal: controller.signal })
      const body = await parseJsonBody(res)
      return { status: res.status, body }
    } catch (error) {
      if (this.stop()) throw new PikpakError('已中断（进度已保存）')
      return { status: undefined, body: { error_description: `network error: ${(error as Error).message}` } }
    } finally {
      clearTimeout(timer)
    }
  }

  private _throttled(status: number | undefined, body: Record<string, unknown>): boolean {
    const text = str(body.error_description || body.error || '').toLowerCase()
    return status === 429
      || body.error_code === 4002 || body.error_code === 4003
      || text.includes('slow down') || text.includes('too many')
      || text.includes('rate limit') || text.includes('rate_limit') || text.includes('ratelimit')
  }

  private _responseError(status: number | undefined, body: Record<string, unknown>, action: string): PikpakError {
    const problem = str(body.error_description || body.error || '请求失败')
    const raw = JSON.stringify(body)
    if (status !== undefined && (TRAFFIC_CAP_RE.test(problem) || TRAFFIC_CAP_RE.test(raw))) {
      return new TrafficCapped(`今日下行流量已到上限: ${problem.slice(0, 160)}`, { status, code: num(body.error_code), action })
    }
    return new PikpakError(problem, {
      status,
      code: num(body.error_code),
      action,
      throttled: this._throttled(status, body),
      network: status === undefined,
    })
  }

  async captchaToken(action: string): Promise<string> {
    const cached = this._captchas.get(action)
    if (cached && cached[1] > Date.now() / 1000) return cached[0]

    const accessToken = await this.ensureSession()
    const [sign, stamp] = captchaSign(CLIENT_ID, this.deviceId)
    const { status, body } = await this._raw('POST', `${USER_API}/v1/shield/captcha/init`, {
      jsonBody: {
        client_id: CLIENT_ID,
        action,
        device_id: this.deviceId,
        meta: {
          captcha_sign: sign,
          timestamp: stamp,
          client_version: CLIENT_VERSION,
          package_name: PACKAGE_NAME,
          user_id: this.sessionData.sub,
        },
      },
      headers: { Authorization: `Bearer ${accessToken}` },
    }, true)

    const token = status === 200 ? str(body.captcha_token) : ''
    if (!token) {
      throw new PikpakError(`自动校验凭证申请失败: ${str(body.error_description || body)}`, { status, code: num(body.error_code), action })
    }
    this._captchas.set(action, [token, Date.now() / 1000 + CAPTCHA_TTL])
    return token
  }

  private async call<T>(
    method: string,
    path: string,
    options: {
      params?: Record<string, unknown>
      jsonBody?: unknown
      base?: string
      action?: string
      retries?: number
    } = {},
  ): Promise<T> {
    const action = options.action ?? `${method}:/drive${path}`
    const replaySafe = method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
      || path === '/v1/files:batchTrash' || path === '/v1/files:batchDelete'
    const attempts = options.retries ?? REQUEST_ATTEMPTS
    const base = options.base ?? DRIVE_API

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (this.stop()) throw new PikpakError('已中断（进度已保存）')
      try {
        const token = await this.captchaToken(action)
        if (this.stop()) throw new PikpakError('已中断（进度已保存）')
        const { status, body } = await this._raw(method, `${base}${path}`, {
          params: options.params,
          jsonBody: options.jsonBody,
          headers: { 'x-action': action, 'x-captcha-token': token },
        }, true)
        if (this.stop()) throw new PikpakError('已中断（进度已保存）')

        if (status !== undefined && status >= 200 && status < 300) {
          return body as T
        }

        const error = this._responseError(status, body, action)
        if (!replaySafe && (status === undefined || status >= 500)) {
          const message = `写入请求结果未知，可能已生效: ${error.message}`
          if (path === '/v1/share/restore') {
            throw new RestoreOutcomeUnknown(message, { status, action, network: status === undefined })
          }
          throw new MutationOutcomeUnknown(message, { status, action, network: status === undefined })
        }
        if (error instanceof TrafficCapped) throw error

        const problem = str(body.error_description || body.error || '')
        if ((status === 401 || status === 403) && problem.toLowerCase().includes('token')) {
          this._captchas.clear()
          await this.ensureSession(true)
          error.retryAfter = 0
        }
        if (error.throttled) this._captchas.clear()
        throw error
      } catch (error) {
        if (this.stop()) throw new PikpakError('已中断（进度已保存）')
        if (error instanceof PikpakError) {
          if (!error.transient || !error.replaySafe || error.retryExhausted) throw error
          if (attempt + 1 === attempts) {
            error.retryExhausted = true
            throw error
          }
          const delay = error.retryAfter ?? (error.throttled ? THROTTLE_BACKOFF[attempt] : NETWORK_RETRY_WAITS[attempt])!
          this.log(`请求暂时失败：${error.message}；${delay}s 后重试（${attempt + 2}/${attempts}）`, 'warn')
          await sleepInterruptible(delay * 1000, this.stop)
          continue
        }
        throw error
      }
    }
    throw new Error('attempts must be positive')
  }

  // --------------------------------------------------------------------- read
  about(): Promise<Record<string, unknown>> {
    return this.call('GET', '/v1/about', { params: { with_quotas: 'true', with_third_party_information: 'false' } })
  }

  async space(): Promise<{ limit: number, usage: number, in_trash: number, free: number }> {
    const quota = (await this.about()).quota as Record<string, unknown> | undefined ?? {}
    const limit = num(quota.limit)
    const usage = num(quota.usage)
    return {
      limit,
      usage,
      in_trash: num(quota.usage_in_trash),
      free: limit ? Math.max(limit - usage, 0) : 0,
    }
  }

  async offlineTaskSlots(): Promise<{ limit: number, usage: number }> {
    const quota = ((await this.about()).quotas as Record<string, unknown> | undefined)?.cloud_download as Record<string, unknown> | undefined ?? {}
    return { limit: num(quota.limit), usage: num(quota.usage) }
  }

  async listFolder(parentId = '*', trashed = false): Promise<Record<string, unknown>[]> {
    const params: Record<string, unknown> = {
      limit: 200,
      order: 3,
      filters: JSON.stringify({ trashed: { eq: Boolean(trashed) } }),
      with_audit: 'true',
    }
    if (parentId !== '*' && parentId !== '') params.parent_id = parentId
    return this._paginate('/v1/files', params)
  }

  createFolder(name: string, parentId = '*'): Promise<Record<string, unknown>> {
    return this.call('POST', '/v1/files', {
      jsonBody: { kind: 'drive#folder', name, parent_id: parentId === '*' ? '' : parentId },
    })
  }

  async prepareWorkspace(name = CLOUD_FOLDER_NAME): Promise<string> {
    const folders = (await this.listFolder('*')).filter(item => item.name === name && item.kind === 'drive#folder')
    if (folders.length > 1) throw new PikpakError(`网盘根目录有多个 ${name} 文件夹，请先整理到只剩一个`)
    if (folders.length) return str(folders[0]!.id)
    const created = await this.createFolder(name)
    const file = (created.file ?? created) as Record<string, unknown> | undefined ?? {}
    const folderId = str(file.id)
    if (!folderId) throw new PikpakError(`创建网盘文件夹 ${name} 后没有收到 ID`)
    return folderId
  }

  file(fileId: string): Promise<Record<string, unknown>> {
    return this.call('GET', `/v1/files/${fileId}`)
  }

  async downloadUrl(fileId: string): Promise<{ url: string, meta: Record<string, unknown> }> {
    const data = await this.call<Record<string, unknown>>('GET', `/v1/files/${fileId}`, { params: { usage: 'FETCH' } })
    const links = (data.links ?? {}) as Record<string, unknown>
    const octet = (links['application/octet-stream'] ?? {}) as Record<string, unknown>
    const url = str(octet.url) || str((data.link as Record<string, unknown> | undefined)?.url) || str(data.web_content_link)
    if (!url) throw new PikpakError(`取不到下载地址（返回字段 ${Object.keys(data).sort()}）`, { action: 'GET:/drive/v1/files/<id>' })
    return {
      url,
      meta: {
        name: data.name,
        size: num(data.size),
        hash: data.hash,
        mime: data.mime_type,
        phase: data.phase,
      },
    }
  }

  // -------------------------------------------------------------------- share
  shareInfo(shareId: string, passCode = ''): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = { share_id: shareId, limit: 200, order: 3 }
    if (passCode) params.pass_code = passCode
    return this.call('GET', '/v1/share', { params })
  }

  async shareChildren(shareId: string, passCodeToken: string, parentId: string): Promise<Record<string, unknown>[]> {
    const params: Record<string, unknown> = { share_id: shareId, pass_code_token: passCodeToken, limit: 200, order: 6 }
    if (parentId) params.parent_id = parentId
    return this._paginate('/v1/share/detail', params)
  }

  node(item: Record<string, unknown>, prefix = '', parentId = ''): Record<string, unknown> {
    const params = (item.params ?? {}) as Record<string, unknown>
    const folder = isFolder(item)
    const name = str(item.name)
    return {
      id: item.id,
      name,
      prefix,
      parent_id: parentId,
      path: prefix ? `${prefix}/${name}` : name,
      is_folder: folder,
      size: num(item.size) || num(params.total_size),
      child_count: folder ? num(params.total_count) : undefined,
      hash: item.hash || null,
      mime: str(item.mime_type),
    }
  }

  async walkShare(
    shareId: string,
    passCode = '',
    maxNodes = 20000,
    rootId = '',
  ): Promise<Record<string, unknown>> {
    const info = await this.shareInfo(shareId, passCode)
    const status = str(info.share_status)
    if (status && status !== 'OK') {
      const reason = str(info.share_status_text) || '服务端未提供说明'
      throw new PikpakError(`分享不可用（${status}）：${reason}`)
    }
    const token = str(info.pass_code_token)

    const nodes: Record<string, unknown>[] = []
    for (const item of await this.shareChildren(shareId, token, rootId)) {
      nodes.push(this.node(item))
      if (nodes.length >= maxNodes) break
    }
    if (!nodes.length) {
      const where = rootId ? '链接指定的文件夹' : '分享根目录'
      throw new PikpakError(`${where}返回空清单，无法确认分享真的为空；已停止处理此链接`)
    }

    const queue: Array<[string, string]> = nodes.filter(n => n.is_folder).map(n => [str(n.id), str(n.path)])
    while (queue.length && nodes.length < maxNodes) {
      const [folderId, prefix] = queue.shift()!
      for (const item of await this.shareChildren(shareId, token, folderId)) {
        const node = this.node(item, prefix, folderId)
        nodes.push(node)
        if (node.is_folder) queue.push([str(node.id), str(node.path)])
        if (nodes.length >= maxNodes) break
      }
    }

    return {
      share_id: shareId,
      title: info.title,
      pass_code_token: token,
      file_num: info.file_num,
      nodes,
      truncated: Boolean(queue.length) || nodes.length >= maxNodes,
    }
  }

  // ------------------------------------------------------------------- change
  restore(shareId: string, passCodeToken: string, fileIds: string[], parentId = '*'): Promise<Record<string, unknown>> {
    return this.call('POST', '/v1/share/restore', {
      jsonBody: { share_id: shareId, pass_code_token: passCodeToken, file_ids: fileIds, parent_id: parentId },
      retries: 1,
    })
  }

  task(taskId: string): Promise<Record<string, unknown>> {
    return this.call('GET', `/v1/tasks/${taskId}`)
  }

  batchTrash(ids: string[]): Promise<Record<string, unknown>> {
    return this.call('POST', '/v1/files:batchTrash', { jsonBody: { ids } })
  }

  batchDelete(ids: string[]): Promise<Record<string, unknown>> {
    return this.call('POST', '/v1/files:batchDelete', { jsonBody: { ids } })
  }

  async cleanup(ids: string[]): Promise<Record<string, unknown>> {
    const kept = ids.filter(Boolean)
    if (!kept.length) return {}
    await this.batchTrash(kept)
    return this.batchDelete(kept)
  }

  // ----------------------------------------------------------------  internal
  private async _paginate(path: string, params: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = []
    let pageToken: string | undefined
    while (true) {
      const request: Record<string, unknown> = { ...params }
      if (pageToken) request.page_token = pageToken
      const body = await this.call<Record<string, unknown>>('GET', path, { params: request })
      for (const item of (body.files ?? []) as Record<string, unknown>[]) out.push(item)
      pageToken = str(body.next_page_token) || undefined
      if (!pageToken) return out
    }
  }
}
