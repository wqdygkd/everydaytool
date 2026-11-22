// 引擎门面：把「本机内嵌 PikpakEngine」与「NAS HTTP 服务」统一成同一组 IPC 语义。
// 本机直接调用 TS 引擎（无子进程）；NAS 走 net.fetch。字段统一为 shared 的 camelCase。
import type {
  PikpakGetAccount,
  PikpakGetEngineInfo,
  PikpakGetExport,
  PikpakGetLink,
  PikpakGetParseResult,
  PikpakGetTask,
  PikpakGetTaskInput,
  PikpakGetWhoami,
} from '../../../../shared/pikpak-get.ts'
import type { StoredConnection } from '../store/connection.ts'
import type { PikpakAccountView } from './accounts.ts'
import type { PikpakTask } from './engine.ts'
import type { PikpakLink } from './links.ts'
import type { PikpakParseRaw, PikpakWhoamiRaw } from './mapping.ts'
import { net } from 'electron'
import { resolveLayerPath } from '../../../../backend/utils/data-layers.ts'
import { openSecretDetailed } from '../../../../backend/utils/secret-box.ts'
import { readConnection } from '../store/connection.ts'
import { getLocalEngineConfig, setLocalEngineMasterKey } from '../store/local-engine-store.ts'
import { PikpakEngine } from './engine.ts'
import { mapAccount, mapLink, mapParseResult, mapTask, mapWhoami, toEngineTaskInput } from './mapping.ts'

export interface PikpakEngineFacade {
  check: () => Promise<PikpakGetEngineInfo>
  listAccounts: () => Promise<PikpakGetAccount[]>
  login: (label: string, password: string) => Promise<PikpakGetAccount>
  refreshAccount: (accountId: string) => Promise<PikpakGetAccount>
  revealPassword: (accountId: string) => Promise<{ password: string }>
  whoami: (accountId: string) => Promise<PikpakGetWhoami>
  deleteAccount: (accountId: string) => Promise<{ deleted: boolean }>
  listLinks: () => Promise<PikpakGetLink[]>
  addLink: (url: string, folder?: string, passCode?: string) => Promise<PikpakGetLink>
  updateLink: (linkId: string, patch: { title?: string, folder?: string, passCode?: string, url?: string }) => Promise<PikpakGetLink>
  deleteLink: (linkId: string) => Promise<{ deleted: boolean }>
  parseLink: (linkId: string, force?: boolean) => Promise<PikpakGetParseResult>
  resetRecords: (linkId: string, fileIds: string[]) => Promise<{ reset: number }>
  exportData: () => Promise<PikpakGetExport>
  importData: (payload: PikpakGetExport) => Promise<{ imported: number }>
  listTasks: () => Promise<PikpakGetTask[]>
  getTask: (taskId: string) => Promise<PikpakGetTask>
  startTask: (input: PikpakGetTaskInput) => Promise<PikpakGetTask>
  cancelTask: (taskId: string) => Promise<{ cancelled: boolean }>
}

// ------------------------------------------------------------ 本机内嵌 facade
let localEngine: PikpakEngine | null = null

function localEngineInstance(): PikpakEngine {
  if (localEngine) return localEngine
  const config = getLocalEngineConfig()
  localEngine = new PikpakEngine({
    configDir: resolveLayerPath('config', 'pikpak-get', 'engine'),
    destDir: config.dest,
    masterKey: config.masterKey,
    fetchImpl: (url, init) => net.fetch(url, init),
  })
  return localEngine
}

class LocalEngineFacade implements PikpakEngineFacade {
  private engine(): PikpakEngine {
    return localEngineInstance()
  }

  async check(): Promise<PikpakGetEngineInfo> {
    const engine = this.engine()
    return {
      name: 'pikpak-get-engine',
      version: '0.2.0',
      dest: engine.destRoot,
      accounts: (await engine.accounts.list()).length,
      links: (await engine.links.list()).length,
    }
  }

  async listAccounts(): Promise<PikpakGetAccount[]> {
    return (await this.engine().accounts.list()).map(mapAccount)
  }

  async login(label: string, password: string): Promise<PikpakGetAccount> {
    return mapAccount(await this.engine().accounts.login(label, password))
  }

  async refreshAccount(accountId: string): Promise<PikpakGetAccount> {
    return mapAccount(await this.engine().accounts.refresh(accountId))
  }

  async revealPassword(accountId: string): Promise<{ password: string }> {
    return { password: await this.engine().accounts.revealPassword(accountId) }
  }

  async whoami(accountId: string): Promise<PikpakGetWhoami> {
    return mapWhoami(await this.engine().accounts.whoami(accountId))
  }

  async deleteAccount(accountId: string): Promise<{ deleted: boolean }> {
    return { deleted: await this.engine().accounts.logout(accountId) }
  }

  async listLinks(): Promise<PikpakGetLink[]> {
    return (await this.engine().links.list()).map(mapLink)
  }

  async addLink(url: string, folder?: string, passCode?: string): Promise<PikpakGetLink> {
    return mapLink(await this.engine().links.add(url, folder, passCode))
  }

  async updateLink(linkId: string, patch: { title?: string, folder?: string, passCode?: string, url?: string }): Promise<PikpakGetLink> {
    const updated = await this.engine().links.update(linkId, patch)
    if (!updated) throw new Error('link not found')
    return mapLink(updated)
  }

  async deleteLink(linkId: string): Promise<{ deleted: boolean }> {
    return { deleted: await this.engine().links.remove(linkId) }
  }

  async parseLink(linkId: string, force?: boolean): Promise<PikpakGetParseResult> {
    return mapParseResult(await this.engine().parseLink(linkId, force))
  }

  async resetRecords(linkId: string, fileIds: string[]): Promise<{ reset: number }> {
    return { reset: await this.engine().resetRecords(linkId, fileIds) }
  }

  async exportData(): Promise<PikpakGetExport> {
    const data = await this.engine().exportData()
    return {
      format: String(data.format ?? 'pikpak-get-export'),
      version: Number(data.version ?? 1),
      masterKey: String(data.masterKey ?? ''),
      files: (data.files ?? {}) as Record<string, string>,
      exportedAt: String(data.exportedAt ?? ''),
    }
  }

  async importData(payload: PikpakGetExport): Promise<{ imported: number }> {
    const count = await this.engine().importData(payload.files ?? {})
    if (payload.masterKey) {
      setLocalEngineMasterKey(payload.masterKey)
      disposeLocalEngine()
    }
    return { imported: count }
  }

  async listTasks(): Promise<PikpakGetTask[]> {
    return this.engine().listTasks().map(mapTask)
  }

  async getTask(taskId: string): Promise<PikpakGetTask> {
    const task = this.engine().getTask(taskId)
    if (!task) throw new Error('task not found')
    return mapTask(task)
  }

  async startTask(input: PikpakGetTaskInput): Promise<PikpakGetTask> {
    const task = await this.engine().createTask(input.linkId, input.fileIds ?? null, input.dest ?? null, input.accountId ?? null)
    this.engine().enqueue(task.id)
    return mapTask(task)
  }

  async cancelTask(taskId: string): Promise<{ cancelled: boolean }> {
    return { cancelled: this.engine().cancelTask(taskId) }
  }
}

// ---------------------------------------------------------------- NAS facade
// 引擎返回的是内部 snake_case JSON，渲染层要的是 shared 的 camelCase，
// 所以这里必须逐个映射（漏一个就是渲染层拿到 undefined，例如 parse.linkId → 「ID 非法」）。
class NasEngineFacade implements PikpakEngineFacade {
  constructor(private readonly stored: StoredConnection) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.stored.url || !this.stored.tokenSealed) throw new Error('尚未配置 NAS 引擎连接')
    const opened = openSecretDetailed(this.stored.tokenSealed, 'pikpak-get-engine-token')
    if (opened.failed || !opened.value) throw new Error('NAS 引擎 token 无法解密（换机后请重新填写）')
    const response = await net.fetch(`${this.stored.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${opened.value}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`引擎返回 ${response.status}${text ? `：${text}` : ''}`)
    }
    return (await response.json()) as T
  }

  async check(): Promise<PikpakGetEngineInfo> {
    return this.request<PikpakGetEngineInfo>('GET', '/auth/check')
  }

  async listAccounts(): Promise<PikpakGetAccount[]> {
    return (await this.request<PikpakAccountView[]>('GET', '/accounts')).map(mapAccount)
  }

  async login(label: string, password: string): Promise<PikpakGetAccount> {
    return mapAccount(await this.request<PikpakAccountView>('POST', '/accounts/login', { label, password }))
  }

  async refreshAccount(accountId: string): Promise<PikpakGetAccount> {
    return mapAccount(await this.request<PikpakAccountView>('POST', `/accounts/${accountId}/refresh`))
  }

  revealPassword(accountId: string) { return this.request<{ password: string }>('POST', `/accounts/${accountId}/reveal-password`) }
  async whoami(accountId: string): Promise<PikpakGetWhoami> {
    return mapWhoami(await this.request<PikpakWhoamiRaw>('GET', `/accounts/${accountId}/whoami`))
  }

  deleteAccount(accountId: string) { return this.request<{ deleted: boolean }>('DELETE', `/accounts/${accountId}`) }

  async listLinks(): Promise<PikpakGetLink[]> {
    return (await this.request<PikpakLink[]>('GET', '/links')).map(mapLink)
  }

  async addLink(url: string, folder?: string, passCode?: string): Promise<PikpakGetLink> {
    return mapLink(await this.request<PikpakLink>('POST', '/links', { url, folder: folder ?? null, passCode: passCode ?? null }))
  }

  async updateLink(linkId: string, patch: { title?: string, folder?: string, passCode?: string, url?: string }): Promise<PikpakGetLink> {
    return mapLink(await this.request<PikpakLink>('PATCH', `/links/${linkId}`, patch))
  }

  deleteLink(linkId: string) { return this.request<{ deleted: boolean }>('DELETE', `/links/${linkId}`) }

  async parseLink(linkId: string, force?: boolean): Promise<PikpakGetParseResult> {
    return mapParseResult(await this.request<PikpakParseRaw>('POST', `/links/${linkId}/parse`, { force: force === true }))
  }

  resetRecords(linkId: string, fileIds: string[]) { return this.request<{ reset: number }>('POST', `/links/${linkId}/reset-records`, { file_ids: fileIds }) }
  exportData() { return this.request<PikpakGetExport>('GET', '/export') }
  importData(payload: PikpakGetExport) { return this.request<{ imported: number }>('POST', '/import', payload) }

  async listTasks(): Promise<PikpakGetTask[]> {
    return (await this.request<PikpakTask[]>('GET', '/tasks')).map(mapTask)
  }

  async getTask(taskId: string): Promise<PikpakGetTask> {
    return mapTask(await this.request<PikpakTask>('GET', `/tasks/${taskId}`))
  }

  async startTask(input: PikpakGetTaskInput): Promise<PikpakGetTask> {
    return mapTask(await this.request<PikpakTask>('POST', '/tasks', toEngineTaskInput(input)))
  }

  cancelTask(taskId: string) { return this.request<{ cancelled: boolean }>('POST', `/tasks/${taskId}/cancel`) }
}

// ------------------------------------------------------------------ 选择门面
export function getEngineFacade(): PikpakEngineFacade {
  const stored = readConnection()
  if (stored.mode === 'local') return new LocalEngineFacade()
  return new NasEngineFacade(stored)
}

export function disposeLocalEngine(): void {
  localEngine = null
}
