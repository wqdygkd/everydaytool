import type { PikpakFetch, PikpakLogger, PikpakSession, PikpakStop } from './api.ts'
// 账号池：复用 PikpakClient 做登录/续期，密码、会话、device_id 用 edt-kdf:v1 信封加密落盘。
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PikpakClient } from './api.ts'
import { openSealed, seal } from './crypto.ts'
import { PikpakError } from './errors.ts'

const TRAFFIC_RETRY_SECONDS = 60 * 60

interface AccountItem {
  id: string
  label: string
  password_sealed: string
  traffic_capped_at: number | null
  created_at: string
  updated_at: string
}

export interface PikpakAccountView {
  id: string
  label: string
  traffic_capped_at: number | null
  created_at: string
  updated_at: string
  traffic: { capped_at: number | null, retry_at: number | null, remaining: number }
}

export interface AccountsContext {
  configDir: string
  masterKey: string
  fetchImpl?: PikpakFetch
  logger?: PikpakLogger
  stop?: PikpakStop
}

export class AccountStore {
  private readonly configDir: string
  private readonly masterKey: string
  private readonly fetchImpl?: PikpakFetch
  private readonly logger?: PikpakLogger
  private readonly stop?: PikpakStop

  constructor(context: AccountsContext) {
    this.configDir = context.configDir
    this.masterKey = context.masterKey
    this.fetchImpl = context.fetchImpl
    this.logger = context.logger
    this.stop = context.stop
  }

  private registryPath(): string {
    return path.join(this.configDir, 'accounts.json')
  }

  private accountDir(accountId: string): string {
    return path.join(this.configDir, 'accounts', accountId)
  }

  private sessionFile(accountId: string): string {
    return path.join(this.accountDir(accountId), 'session.edt')
  }

  private deviceFile(accountId: string): string {
    return path.join(this.accountDir(accountId), 'device_id.edt')
  }

  private async loadRegistry(): Promise<AccountItem[]> {
    try {
      const raw = await readFile(this.registryPath(), 'utf8')
      const data = JSON.parse(raw)
      return Array.isArray(data) ? data as AccountItem[] : []
    } catch {
      return []
    }
  }

  private async saveRegistry(items: AccountItem[]): Promise<void> {
    const file = this.registryPath()
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, `${JSON.stringify(items, null, 1)}\n`, 'utf8')
    await rename(tmp, file)
  }

  private async writeText(filePath: string, text: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp`
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, filePath)
  }

  private async readText(filePath: string): Promise<string | null> {
    try {
      return (await readFile(filePath, 'utf8')).trim()
    } catch {
      return null
    }
  }

  private sealSession(accountId: string, session: PikpakSession): string {
    return seal(JSON.stringify(session), this.masterKey, accountId, 'session')
  }

  private sealDevice(accountId: string, deviceId: string): string {
    return seal(deviceId, this.masterKey, accountId, 'device_id')
  }

  private sealPassword(accountId: string, password: string): string {
    return seal(password, this.masterKey, accountId, 'password')
  }

  private openSession(accountId: string, envelope: string): PikpakSession {
    return JSON.parse(openSealed(envelope, this.masterKey, accountId, 'session')) as PikpakSession
  }

  private openDevice(accountId: string, envelope: string): string {
    return openSealed(envelope, this.masterKey, accountId, 'device_id')
  }

  private openPassword(accountId: string, envelope: string): string {
    return openSealed(envelope, this.masterKey, accountId, 'password')
  }

  private accountIdOf(userId: string): string {
    return createHash('sha256').update(String(userId)).digest('hex').slice(0, 24)
  }

  private view(item: AccountItem): PikpakAccountView {
    const now = Date.now() / 1000
    const retryAt = item.traffic_capped_at ? item.traffic_capped_at + TRAFFIC_RETRY_SECONDS : null
    return {
      id: item.id,
      label: item.label,
      traffic_capped_at: item.traffic_capped_at,
      created_at: item.created_at,
      updated_at: item.updated_at,
      traffic: {
        capped_at: item.traffic_capped_at,
        retry_at: retryAt,
        remaining: retryAt ? Math.max(retryAt - now, 0) : 0,
      },
    }
  }

  async list(): Promise<PikpakAccountView[]> {
    return (await this.loadRegistry()).map(item => this.view(item))
  }

  async login(label: string, password: string): Promise<PikpakAccountView> {
    const items = await this.loadRegistry()
    const known = items.find(item => item.label === label)
    if (items.filter(item => item.label === label).length > 1) {
      throw new PikpakError(`账号名称 ${label} 重复，请先检查账号列表`)
    }

    let deviceId = randomUUID().replace(/-/g, '')
    if (known) {
      const envelope = await this.readText(this.deviceFile(known.id))
      if (!envelope) throw new PikpakError(`账号 ${label} 缺少设备指纹，请先删除后重新登录`)
      deviceId = this.openDevice(known.id, envelope)
    }

    const client = new PikpakClient({
      fetchImpl: this.fetchImpl,
      deviceId,
      logger: this.logger,
      stop: this.stop,
    })
    const session = await client.signIn(label, password)
    const userId = session.sub
    if (!userId) throw new PikpakError('登录响应没有用户 ID，无法安全保存多账号会话')
    const accountId = this.accountIdOf(userId)
    if (known && known.id !== accountId) {
      throw new PikpakError('该登录名称对应的服务端账号已变化；请先退出原账号再登录')
    }

    const now = new Date().toISOString()
    const item: AccountItem = {
      id: accountId,
      label,
      password_sealed: this.sealPassword(accountId, password),
      traffic_capped_at: known?.traffic_capped_at ?? null,
      created_at: known?.created_at ?? now,
      updated_at: now,
    }
    await this.writeText(this.sessionFile(accountId), this.sealSession(accountId, session))
    await this.writeText(this.deviceFile(accountId), this.sealDevice(accountId, deviceId))
    const rest = items.filter(entry => entry.id !== accountId)
    rest.unshift(item)
    await this.saveRegistry(rest)
    return this.view(item)
  }

  async clientFor(accountId: string): Promise<PikpakClient> {
    const items = await this.loadRegistry()
    const item = items.find(entry => entry.id === accountId)
    if (!item) throw new PikpakError(`账号不存在：${accountId}`)
    const sessionEnvelope = await this.readText(this.sessionFile(accountId))
    const deviceEnvelope = await this.readText(this.deviceFile(accountId))
    if (!sessionEnvelope || !deviceEnvelope) {
      throw new PikpakError(`账号 ${item.label} 缺少会话或设备指纹；请重新登录`)
    }
    const session = this.openSession(accountId, sessionEnvelope)
    const deviceId = this.openDevice(accountId, deviceEnvelope)
    return new PikpakClient({
      fetchImpl: this.fetchImpl,
      deviceId,
      session,
      logger: this.logger,
      stop: this.stop,
      onSession: (next) => {
        void this.writeText(this.sessionFile(accountId), this.sealSession(accountId, next))
      },
    })
  }

  async refresh(accountId: string): Promise<PikpakAccountView> {
    const client = await this.clientFor(accountId)
    await client.ensureSession(true)
    const items = await this.loadRegistry()
    return this.view(items.find(entry => entry.id === accountId)!)
  }

  async revealPassword(accountId: string): Promise<string> {
    const item = (await this.loadRegistry()).find(entry => entry.id === accountId)
    if (!item) throw new PikpakError(`账号不存在：${accountId}`)
    return this.openPassword(accountId, item.password_sealed)
  }

  async whoami(accountId: string): Promise<{ usage: number, limit: number, in_trash: number, free: number, expires_at: string }> {
    const client = await this.clientFor(accountId)
    await client.ensureSession()
    const about = await client.about()
    const space = await client.space()
    const expires = String(about.expires_at ?? '').trim()
    return {
      usage: space.usage,
      limit: space.limit,
      in_trash: space.in_trash,
      free: space.free,
      expires_at: expires ? expires.split('T')[0]! : '',
    }
  }

  async logout(accountId: string): Promise<boolean> {
    const items = await this.loadRegistry()
    const item = items.find(entry => entry.id === accountId)
    if (!item) return false
    await this.saveRegistry(items.filter(entry => entry.id !== accountId))
    await rm(this.accountDir(accountId), { recursive: true, force: true })
    return true
  }

  async trafficRetryAt(accountId: string): Promise<number> {
    const item = (await this.loadRegistry()).find(entry => entry.id === accountId)
    if (!item?.traffic_capped_at) return 0
    return item.traffic_capped_at + TRAFFIC_RETRY_SECONDS
  }

  async markTrafficCapped(accountId: string): Promise<void> {
    const items = await this.loadRegistry()
    const item = items.find(entry => entry.id === accountId)
    if (!item) return
    item.traffic_capped_at = Date.now() / 1000
    item.updated_at = new Date().toISOString()
    await this.saveRegistry(items)
  }

  async choose(excluded: Set<string> = new Set(), only?: string, respectCooldown = true): Promise<string | null> {
    const items = await this.loadRegistry()
    const candidates = only ? items.filter(item => item.id === only) : items
    const now = Date.now() / 1000
    for (const item of candidates) {
      if (excluded.has(item.id)) continue
      if (respectCooldown) {
        const retryAt = item.traffic_capped_at ? item.traffic_capped_at + TRAFFIC_RETRY_SECONDS : 0
        if (retryAt > now) continue
      }
      return item.id
    }
    return null
  }
}
