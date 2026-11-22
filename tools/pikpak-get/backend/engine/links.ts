// 分享链接注册表（明文；链接本身非敏感）。
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseShareUrl, shareRootId } from './api.ts'
import { safeName } from './pipeline.ts'

const DEFAULT_FOLDER = '未分组'

export interface ParseCache {
  title: string
  file_num: number | null
  truncated: boolean
  nodes: unknown[]
}

export interface PikpakLink {
  id: string
  url: string
  title: string
  folder: string
  share_id: string
  pass_code: string
  root_id: string
  created_at: string
  updated_at: string
  parsed_at: string | null
  parse_cache: ParseCache | null
}

export class LinkStore {
  constructor(private readonly configDir: string) {}

  private linksPath(): string {
    return path.join(this.configDir, 'links.json')
  }

  private async load(): Promise<PikpakLink[]> {
    try {
      const raw = await readFile(this.linksPath(), 'utf8')
      const data = JSON.parse(raw)
      return Array.isArray(data) ? data as PikpakLink[] : []
    } catch {
      return []
    }
  }

  private async save(items: PikpakLink[]): Promise<void> {
    const file = this.linksPath()
    await mkdir(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, `${JSON.stringify(items, null, 1)}\n`, 'utf8')
    await rename(tmp, file)
  }

  async list(): Promise<PikpakLink[]> {
    return this.load()
  }

  async get(linkId: string): Promise<PikpakLink | null> {
    return (await this.load()).find(item => item.id === linkId) ?? null
  }

  async add(url: string, folder?: string, passCode?: string): Promise<PikpakLink> {
    const trimmed = (url || '').trim()
    if (!trimmed) throw new Error('分享链接不能为空')
    const { shareId, passCode: urlPassCode } = parseShareUrl(trimmed)
    const items = await this.load()
    const now = new Date().toISOString()
    const item: PikpakLink = {
      id: randomUUID().replace(/-/g, '').slice(0, 16),
      url: trimmed.split('?')[0]!.replace(/\/+$/, ''),
      title: '',
      folder: safeName(folder || DEFAULT_FOLDER),
      share_id: shareId,
      pass_code: passCode?.trim() || urlPassCode,
      root_id: shareRootId(trimmed),
      created_at: now,
      updated_at: now,
      parsed_at: null,
      parse_cache: null,
    }
    items.unshift(item)
    await this.save(items)
    return item
  }

  async update(linkId: string, patch: { title?: string, folder?: string, passCode?: string, url?: string }): Promise<PikpakLink | null> {
    const items = await this.load()
    const item = items.find(entry => entry.id === linkId)
    if (!item) return null
    if (patch.url !== undefined && patch.url.trim()) {
      const trimmed = patch.url.trim()
      const { shareId, passCode: urlPassCode } = parseShareUrl(trimmed)
      item.url = trimmed.split('?')[0]!.replace(/\/+$/, '')
      item.share_id = shareId
      item.root_id = shareRootId(trimmed)
      // URL 里带密码且本次未显式改密码时，跟随新 URL 的密码
      if (patch.passCode === undefined && urlPassCode) item.pass_code = urlPassCode
      item.parsed_at = null
      item.parse_cache = null
    }
    if (patch.folder !== undefined) item.folder = safeName(patch.folder)
    if (patch.title !== undefined) item.title = String(patch.title).slice(0, 200)
    if (patch.passCode !== undefined) {
      if (patch.passCode.trim() !== item.pass_code) {
        item.parsed_at = null
        item.parse_cache = null
      }
      item.pass_code = patch.passCode.trim()
    }
    item.updated_at = new Date().toISOString()
    await this.save(items)
    return item
  }

  async getParseCache(linkId: string): Promise<{ cache: ParseCache, parsedAt: string } | null> {
    const item = await this.get(linkId)
    if (!item?.parse_cache || !item.parsed_at) return null
    return { cache: item.parse_cache, parsedAt: item.parsed_at }
  }

  async setParseCache(linkId: string, cache: ParseCache): Promise<string> {
    const items = await this.load()
    const item = items.find(entry => entry.id === linkId)
    if (!item) throw new Error(`分享链接不存在：${linkId}`)
    const parsedAt = new Date().toISOString()
    item.parse_cache = cache
    item.parsed_at = parsedAt
    item.updated_at = parsedAt
    await this.save(items)
    return parsedAt
  }

  async remove(linkId: string): Promise<boolean> {
    const items = await this.load()
    const kept = items.filter(entry => entry.id !== linkId)
    if (kept.length === items.length) return false
    await this.save(kept)
    return true
  }
}
