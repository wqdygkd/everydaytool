import type { ExtensionToEdtMessage } from '../../../../shared/interceptor.ts'
import { Buffer } from 'node:buffer'

export const MAX_WS_MESSAGE_BYTES = 64 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}

/** 只接受协议里声明过的消息；未知类型 / 缺字段 / 超长字符串一律丢弃。 */
export function parseExtensionMessage(raw: string, authed: boolean): ExtensionToEdtMessage | null {
  if (Buffer.byteLength(raw, 'utf8') > MAX_WS_MESSAGE_BYTES) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  }
  catch {
    return null
  }
  if (!isRecord(value) || typeof value.type !== 'string') return null
  if (!authed && value.type !== 'hello') return null

  switch (value.type) {
    case 'hello':
      if (
        !isText(value.appId, 80)
        || !isText(value.clientId, 256)
        || typeof value.version !== 'string'
        || typeof value.token !== 'string'
        || value.token.length > 256
      ) {
        return null
      }
      return {
        type: 'hello',
        appId: value.appId,
        clientId: value.clientId,
        version: value.version.slice(0, 80),
        token: value.token,
      }
    case 'ping':
      if (value.at !== undefined && typeof value.at !== 'number') return null
      return { type: 'ping', at: typeof value.at === 'number' ? value.at : Date.now() }
    case 'proxy-state':
      if (typeof value.enabled !== 'boolean') return null
      if (value.error !== undefined && (typeof value.error !== 'string' || value.error.length > 2000)) return null
      return {
        type: 'proxy-state',
        enabled: value.enabled,
        error: typeof value.error === 'string' ? value.error : undefined,
      }
    case 'add-target':
      if (!isHttpUrl(value.url)) return null
      return { type: 'add-target', url: value.url }
    case 'target-toggle':
      if (!isText(value.id) || typeof value.enabled !== 'boolean') return null
      return { type: 'target-toggle', id: value.id, enabled: value.enabled }
    case 'target-remove-id':
      if (!isText(value.id)) return null
      return { type: 'target-remove-id', id: value.id }
    case 'rule-toggle':
      if (!isText(value.id) || typeof value.enabled !== 'boolean') return null
      return { type: 'rule-toggle', id: value.id, enabled: value.enabled }
    case 'rule-remove':
      if (!isText(value.id)) return null
      return { type: 'rule-remove', id: value.id }
    case 'site-info':
      if (!isText(value.requestId) || !isHttpUrl(value.url)) return null
      return { type: 'site-info', requestId: value.requestId, url: value.url }
    case 'target-suggest':
      if (!isText(value.requestId) || !isHttpUrl(value.url)) return null
      return { type: 'target-suggest', requestId: value.requestId, url: value.url }
    case 'script-log':
      if (!isText(value.scriptId) || !['info', 'warn', 'error'].includes(String(value.level))) return null
      if (typeof value.message !== 'string' || value.message.length > 20_000) return null
      return {
        type: 'script-log',
        scriptId: value.scriptId,
        level: value.level as 'info' | 'warn' | 'error',
        message: value.message,
      }
    default:
      return null
  }
}
