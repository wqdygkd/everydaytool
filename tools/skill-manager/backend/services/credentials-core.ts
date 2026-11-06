import type { TokenHostView, TokenState } from '../../../../shared/skill-manager.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'

export interface StoredToken {
  value: string
  updatedAt: string
}

export interface TokenFile {
  version: 1
  tokens: Record<string, StoredToken>
}

export interface TokenCodec {
  seal: (plain: string) => string
  open: (value: string) => { value: string, failed: boolean }
}

export function emptyTokenFile(): TokenFile {
  return { version: 1, tokens: {} }
}

/** 只接受 host / host:port；完整 URL 取 origin 的 host 段，避免把路径当键。 */
export function normalizeTokenHost(input: string): string {
  const value = input.trim()
  if (!value) throw new Error('令牌 host 不能为空')
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    return url.host.toLowerCase()
  }
  catch {
    throw new Error('令牌 host 格式不正确')
  }
}

export function readTokenFile(path: string): TokenFile {
  const value = readJsonDocument<TokenFile>(path, emptyTokenFile)
  if (!value || value.version !== 1 || typeof value.tokens !== 'object' || value.tokens === null) return emptyTokenFile()
  return value
}

export function listTokenHosts(path: string, codec: TokenCodec): TokenState {
  const file = readTokenFile(path)
  const hosts: TokenHostView[] = Object.entries(file.tokens)
    .filter(([host, token]) => Boolean(host) && typeof token?.value === 'string')
    .map(([host, token]) => ({
      host,
      updatedAt: token.updatedAt,
      sealed: codec.open(token.value).failed === false && token.value.startsWith('edt-secret:'),
    }))
    .sort((a, b) => a.host.localeCompare(b.host))
  return { hosts }
}

export function saveToken(path: string, rawHost: string, token: string, codec: TokenCodec): TokenState {
  const host = normalizeTokenHost(rawHost)
  const value = token.trim()
  if (!value) throw new Error('令牌不能为空')
  if (value.length > 8192) throw new Error('令牌过长')
  const file = readTokenFile(path)
  file.tokens[host] = {
    value: codec.seal(value),
    updatedAt: new Date().toISOString(),
  }
  writeJsonDocument(path, file)
  return listTokenHosts(path, codec)
}

export function deleteToken(path: string, rawHost: string, codec: TokenCodec): TokenState {
  const host = normalizeTokenHost(rawHost)
  const file = readTokenFile(path)
  delete file.tokens[host]
  writeJsonDocument(path, file)
  return listTokenHosts(path, codec)
}

/** 供 git/GitHub 认证读取；解不开时返回 undefined，不把空串当作新令牌。 */
export function readToken(path: string, rawHost: string, codec: TokenCodec): string | undefined {
  const host = normalizeTokenHost(rawHost)
  const stored = readTokenFile(path).tokens[host]
  if (!stored) return undefined
  const opened = codec.open(stored.value)
  return opened.failed ? undefined : opened.value || undefined
}
