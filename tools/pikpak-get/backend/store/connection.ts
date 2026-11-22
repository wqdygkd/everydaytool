import type {
  PikpakGetConnectionInput,
  PikpakGetConnectionView,
  PikpakGetEngineMode,
} from '../../../../shared/pikpak-get.ts'
import { resolveLayerPath } from '../../../../backend/utils/data-layers.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { sealSecret } from '../../../../backend/utils/secret-box.ts'

export interface StoredConnection {
  mode: PikpakGetEngineMode
  name: string
  url: string
  tokenSealed: string
}

function connectionPath(): string {
  return resolveLayerPath('config', 'pikpak-get', 'connection.json')
}

export function readConnection(): StoredConnection {
  const raw = readJsonDocument<Partial<StoredConnection>>(connectionPath(), () => ({ mode: 'nas' }))
  return {
    mode: raw.mode === 'local' ? 'local' : 'nas',
    name: raw.name ?? '',
    url: raw.url ?? '',
    tokenSealed: raw.tokenSealed ?? '',
  }
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`
  return trimmed.replace(/\/+$/, '')
}

export function getConnectionView(): PikpakGetConnectionView | null {
  const stored = readConnection()
  if (stored.mode === 'local') {
    return { mode: 'local', name: stored.name || '本机引擎', url: '本机（内嵌）', hasToken: true }
  }
  if (!stored.url) return null
  return { mode: 'nas', name: stored.name || 'NAS 引擎', url: stored.url, hasToken: Boolean(stored.tokenSealed) }
}

export function setConnection(input: PikpakGetConnectionInput): PikpakGetConnectionView {
  if (!input) throw new Error('连接参数非法')
  const existing = readConnection()
  const mode: PikpakGetEngineMode = input.mode === 'local' ? 'local' : 'nas'
  const fallbackName = mode === 'local' ? '本机引擎' : 'NAS 引擎'
  const name = (input.name ?? existing.name ?? fallbackName).trim() || fallbackName

  let url = ''
  let tokenSealed = ''
  if (mode === 'nas') {
    if (typeof input.url !== 'string' || !input.url.trim()) throw new Error('引擎地址不能为空')
    url = normalizeUrl(input.url)
    tokenSealed = input.token
      ? sealSecret(input.token.trim(), 'pikpak-get-engine-token')
      : existing.tokenSealed || ''
  }

  writeJsonDocument(connectionPath(), { mode, name, url, tokenSealed })

  if (mode === 'local') return { mode, name, url: '本机（内嵌）', hasToken: true }
  return { mode, name, url, hasToken: Boolean(tokenSealed) }
}
