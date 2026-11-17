// 扩展 WS 信封编解码：平台 v1 信封 ↔ interceptor 扁平消息（内部仍用扁平类型处理业务）。
import type { EdtToExtensionMessage } from '../../../../shared/interceptor.ts'
import {
  isExtensionEnvelope,
  makeEnvelope,
  type ExtensionEnvelope,
  type ExtensionModuleId,
} from '../../../../shared/extension.ts'

/** 出站：扁平 Edt 消息 → 平台信封（线上恒信封） */
export function encodeEdtMessage(message: EdtToExtensionMessage): ExtensionEnvelope {
  if (message.type === 'hello-ok') {
    return makeEnvelope('shell', 'hello-ok', {
      wsPort: message.wsPort,
      modules: ['interceptor'] satisfies ExtensionModuleId[],
      bootstraps: {
        interceptor: {
          proxyPort: message.proxyPort,
          targets: message.targets,
          scripts: message.scripts,
          rules: message.rules,
          proxyDesired: message.proxyDesired,
        },
      },
    })
  }

  if (message.type === 'hello-reject') {
    return makeEnvelope('shell', 'hello-reject', { reason: message.reason })
  }

  if (message.type === 'heartbeat') {
    return makeEnvelope('shell', 'heartbeat', { at: message.at })
  }

  if (message.type === 'site-info-result' || message.type === 'target-suggest-result') {
    const { type, requestId, ...payload } = message
    return makeEnvelope('interceptor', type, payload, requestId)
  }

  const { type, ...payload } = message
  return makeEnvelope('interceptor', type, payload)
}

/**
 * 入站：信封 → 扁平对象（供 parseExtensionMessage 校验）。
 * 非信封则原样返回（兼容尚未 Reload 的旧扁平客户端）。
 */
export function decodeIncomingRaw(value: unknown): unknown {
  if (!isExtensionEnvelope(value)) return value

  if (value.module === 'shell') {
    if (value.type === 'hello' || value.type === 'ping') {
      const payload = (value.payload && typeof value.payload === 'object')
        ? value.payload as Record<string, unknown>
        : {}
      return { type: value.type, ...payload }
    }
    return null
  }

  if (value.module === 'interceptor') {
    const payload = (value.payload && typeof value.payload === 'object')
      ? value.payload as Record<string, unknown>
      : {}
    const flat: Record<string, unknown> = { type: value.type, ...payload }
    if (value.requestId !== undefined) flat.requestId = value.requestId
    return flat
  }

  return null
}
