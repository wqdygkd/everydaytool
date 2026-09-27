import type { TreeaseInterceptLog, TreeaseInterceptPatch, TreeaseInterceptRule, TreeaseInterceptStatus } from '../../../../shared/types.js'
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { TREEASE_WEBVIEW_PARTITION } from '../../../../shared/webview.js'
import { TREEASE_IPC_CHANNELS } from '../ipc/channels.js'

const require = createRequire(import.meta.url)
const { BrowserWindow, session: electronSession, webContents } = require('electron') as typeof import('electron')

type GuestSession = import('electron').Session

// 协议层拦截的 scheme：http/https 全量接管，未命中规则的请求原样透传。
// 相对旧的 debugger + CDP Fetch 方案：不占用调试通道，可与 DevTools 同时使用。
const HANDLED_SCHEMES = ['http', 'https']
const NULL_BODY_STATUS = new Set([204, 205, 304])
const CACHEABLE = 'public, max-age=31536000, immutable'
const BYPASS_CACHE = 'no-store'

interface ActiveIntercept {
  webContentsId: number
  rules: TreeaseInterceptRule[]
  hits: number
}

// 规则状态（随 start/stop 开关）与协议层 handler（常驻）解耦：
// 关 tab / 停止拦截只清空规则，handler 留在 session 上继续提供页面缓存，
// 离线重开 tab 时首次导航即可命中缓存。
let active: ActiveIntercept | null = null
const handlerSessions = new Set<GuestSession>()
function emitLog(): void {
  if (!active) return
  const log: TreeaseInterceptLog = {
    webContentsId: active.webContentsId,
    hits: active.hits,
  }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(TREEASE_IPC_CHANNELS.EVENT_INTERCEPT_LOG, log)
  }
}

function matchesPattern(url: string, pattern: string): boolean {
  if (!pattern.trim()) return true
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(url)
}

function isBlockRule(rule: TreeaseInterceptRule): boolean {
  return rule.action === 'block'
}

function isRuleActive(rule: TreeaseInterceptRule): boolean {
  if (!rule || !rule.enabled || !rule.urlPattern || !rule.urlPattern.trim()) return false
  if (isBlockRule(rule)) return true
  return Array.isArray(rule.patches) && rule.patches.some(p => p && p.path && p.path.trim())
}

function setPath(root: unknown, path: string, value: unknown): boolean {
  const keys = path.split('.').map(k => k.trim()).filter(k => k.length > 0)
  if (!keys.length || typeof root !== 'object' || root === null) return false
  let cur: unknown = root
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (typeof cur !== 'object' || cur === null) return false
    const rec = cur as Record<string, unknown>
    const next = rec[keys[i]]
    if (typeof next !== 'object' || next === null) {
      rec[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {}
    }
    cur = (cur as Record<string, unknown>)[keys[i]]
  }
  if (typeof cur !== 'object' || cur === null) return false
  const target = cur as Record<string, unknown>
  target[keys[keys.length - 1]] = value
  return true
}

function applyPatches(raw: Buffer, patches: TreeaseInterceptPatch[]): { buf: Buffer, applied: number } | null {
  const valid = (patches || []).filter(p => p && p.path && p.path.trim())
  if (!valid.length) return null
  let data: unknown
  try {
    data = JSON.parse(raw.toString('utf8'))
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  let applied = 0
  for (const p of valid) {
    if (setPath(data, p.path, p.value)) applied += 1
  }
  if (!applied) return null
  return { buf: Buffer.from(JSON.stringify(data), 'utf8'), applied }
}

function findRule(url: string, action: 'modify' | 'block'): TreeaseInterceptRule | null {
  if (!active) return null
  for (const rule of active.rules) {
    if (!isRuleActive(rule)) continue
    const kind = isBlockRule(rule) ? 'block' : 'modify'
    if (kind !== action) continue
    if (matchesPattern(url, rule.urlPattern)) return rule
  }
  return null
}

// body 被消费或改写后长度/编码声明会失效；缓存策略交给 Electron 的 HTTP cache
function responseHeaders(headers: Headers, mode: 'cache' | 'bypass'): Headers {
  const out = new Headers(headers)
  out.delete('content-length')
  out.delete('content-encoding')
  out.set('cache-control', mode === 'cache' ? CACHEABLE : BYPASS_CACHE)
  return out
}

// 只让文档和静态子资源进缓存；XHR/fetch 动态接口与 Range 分片不缓存
function isCacheableRequest(request: Request): boolean {
  if (request.method !== 'GET' || request.headers.has('range')) return false
  const dest = (request.headers.get('sec-fetch-dest') || '').toLowerCase()
  return !dest || dest !== 'empty'
}

async function handleProtocolRequest(session: GuestSession, request: Request): Promise<Response> {
  const url = request.url
  // 屏蔽类规则：直接让请求失败（等价于旧方案的 BlockedByClient）
  if (findRule(url, 'block')) {
    if (active) {
      active.hits += 1
      emitLog()
    }
    throw new Error(`BlockedByClient: ${url}`)
  }
  const modifyRule = findRule(url, 'modify')
  const cacheMode = !modifyRule && isCacheableRequest(request) ? 'cache' : 'bypass'
  if (!modifyRule) {
    // 未命中：同 session 透传（cookie/代理不变），跳过自定义协议避免递归
    const upstream = await session.fetch(request, { bypassCustomProtocolHandlers: true })
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream.headers, cacheMode),
    })
  }
  const upstream = await session.fetch(request, { bypassCustomProtocolHandlers: true })
  const contentType = upstream.headers.get('content-type') ?? ''
  if (!contentType.includes('json') || NULL_BODY_STATUS.has(upstream.status) || request.method === 'HEAD') {
    return upstream
  }
  let text: string
  try {
    text = await upstream.text()
  } catch {
    // body 读失败：已消费的流无法回退，重建空等价响应透传
    return new Response(null, { status: upstream.status, headers: responseHeaders(upstream.headers, 'bypass') })
  }
  const modified = applyPatches(Buffer.from(text, 'utf8'), modifyRule.patches)
  if (!modified) {
    return new Response(text, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream.headers, 'bypass'),
    })
  }
  if (active) {
    active.hits += 1
    emitLog()
  }
  return new Response(modified.buf, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders(upstream.headers, 'bypass'),
  })
}

function ensureProtocolHandlers(session: GuestSession): void {
  if (handlerSessions.has(session)) return
  const handler = (request: Request): Promise<Response> => handleProtocolRequest(session, request)
  for (const scheme of HANDLED_SCHEMES) {
    try {
      session.protocol.handle(scheme, handler)
    } catch {
      try {
        session.protocol.unhandle(scheme)
        session.protocol.handle(scheme, handler)
      } catch {
        // 忽略：保持透传
      }
    }
  }
  handlerSessions.add(session)
}

function removeProtocolHandlers(session: GuestSession): void {
  handlerSessions.delete(session)
  for (const scheme of HANDLED_SCHEMES) {
    try {
      session.protocol.unhandle(scheme)
    } catch {
      // 忽略
    }
  }
}

// 后端 initialize 时调用：按分区预装 handler，首个 webview 导航前即接管网络。
// 即使拦截从未启动（active 为空），页面缓存依然工作；规则匹配需要 start()。
export function installCacheHandlers(): void {
  try {
    ensureProtocolHandlers(electronSession.fromPartition(TREEASE_WEBVIEW_PARTITION))
  } catch {
    // 忽略：start() 时会按 guest session 再次确保安装
  }
}

function toStatus(state: ActiveIntercept): TreeaseInterceptStatus {
  const rules = state.rules.filter(isRuleActive)
  return {
    webContentsId: state.webContentsId,
    attached: true,
    ruleCount: rules.length,
    hits: state.hits,
  }
}

function sanitizeRules(rules: TreeaseInterceptRule[]): TreeaseInterceptRule[] {
  if (!Array.isArray(rules)) throw new Error('拦截规则非法')
  return rules
    .filter(r => r && typeof r.urlPattern === 'string' && Array.isArray(r.patches))
    .map((r, i) => ({
      id: typeof r.id === 'string' && r.id ? r.id : `rule_${i}`,
      name: typeof r.name === 'string' ? r.name : '',
      enabled: r.enabled !== false,
      urlPattern: r.urlPattern,
      action: r.action === 'block' ? 'block' as const : 'modify' as const,
      patches: r.patches.filter(p => p && typeof p.path === 'string'),
    }))
}

export const interceptService = {
  async start(webContentsId: number, rules: TreeaseInterceptRule[]): Promise<TreeaseInterceptStatus> {
    const sanitized = sanitizeRules(rules)
    if (!sanitized.some(isRuleActive)) {
      throw new Error('请至少启用一个接口规则（匹配 pattern，修改或屏蔽）')
    }
    if (active && active.webContentsId === webContentsId) {
      active.rules = sanitized
      return toStatus(active)
    }
    const guest = webContents.fromId(webContentsId)
    if (!guest || guest.isDestroyed()) {
      throw new Error('页面内核不存在或已被销毁，请刷新页面后重试')
    }
    // handler 常驻：只确保安装，不接管其生命周期
    ensureProtocolHandlers(guest.session)
    active = { webContentsId, rules: sanitized, hits: 0 }
    guest.once('destroyed', () => {
      if (active && active.webContentsId === webContentsId) active = null
    })
    return toStatus(active)
  },

  // 停止只下掉规则（改写/屏蔽失效），页面缓存继续由常驻 handler 提供
  async stop(webContentsId: number): Promise<boolean> {
    if (!active || active.webContentsId !== webContentsId) return false
    active = null
    return true
  },

  async updateRules(webContentsId: number, rules: TreeaseInterceptRule[]): Promise<TreeaseInterceptStatus> {
    if (!active || active.webContentsId !== webContentsId) throw new Error('拦截未启动，请先启动拦截')
    active.rules = sanitizeRules(rules)
    return toStatus(active)
  },

  getStatus(webContentsId: number): TreeaseInterceptStatus | null {
    return active && active.webContentsId === webContentsId ? toStatus(active) : null
  },

  async stopAll(): Promise<void> {
    active = null
    for (const session of [...handlerSessions]) {
      removeProtocolHandlers(session)
    }
  },

  // 手动刷新用：清 Chromium 缓存，调用方随后 reload 即重新加载最新并缓存
  async clearCache(): Promise<void> {
    await electronSession.fromPartition(TREEASE_WEBVIEW_PARTITION).clearCache()
  },
}
