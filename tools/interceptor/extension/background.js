// edt 拦截器扩展 service worker：
// - WS 客户端：59763 起端口段扫描 → hello 握手（无需配对码，edt 侧只校验来源 Origin）→ 心跳/自动重连（对 Requestly 短板的补齐）；
// - 代理控制：chrome.proxy fixed_servers（B 模式）+ 自有端口 bypass（避免 WS 被自身代理圈进）；
//   fail-open：断线自动撤代理（Requestly 实践）；
// - 名单/脚本：全部状态来自 edt（targets-sync / scripts-sync），扩展只回传动作与状态；
// - 代理端口：由 edt 下发（hello-ok / proxy-port），扩展不硬编码；
// - 脚本注入：chrome.userScripts 动态注册（支持任意代码正文，需开发者模式——unpacked 场景天然满足）。
'use strict'

const WS_PORT_BASE = 59763
const WS_PORT_RANGE = 5
const RECONNECT_ALARM = 'edt-interceptor-reconnect'
const CONNECT_TIMEOUT_MS = 1200
const HELLO_TIMEOUT_MS = 3000
/** edt 心跳 20s 一次：超过这个时间一条消息都没有，就当连接僵死（SW 冻结/恢复后残留 socket） */
const STALE_CONNECTION_MS = 60_000
const PROXY_SCOPE = 'regular'

/** @type {{socket: WebSocket|null, connected: boolean, connecting: Promise<void>|null, wsPort: number|null, proxyPort: number|null, targets: Array<object>, scripts: Array<object>, rules: Array<object>, lastError: string|null, appId: string, clientId: string, version: string, lastMessageAt: number}} */
const state = {
  socket: null,
  connected: false,
  connecting: null,
  wsPort: null,
  proxyPort: null,
  targets: [],
  scripts: [],
  rules: [],
  lastError: null,
  appId: detectAppId(),
  clientId: '',
  version: chrome.runtime.getManifest().version,
  lastMessageAt: 0,
}

function detectAppId() {
  const ua = globalThis.navigator?.userAgent || ''
  if (/Edg\//.test(ua)) return 'existing-edge'
  if (/OPR\//.test(ua)) return 'existing-opera'
  if (/Brave/.test(ua)) return 'existing-brave'
  return 'existing-chrome'
}

async function getSettings() {
  const data = await chrome.storage.local.get({ proxyEnabled: false, lastWsPort: 0, clientId: '' })
  if (!data.clientId) {
    data.clientId = crypto.randomUUID()
    await chrome.storage.local.set({ clientId: data.clientId })
  }
  state.clientId = data.clientId
  return data
}

function setBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? 'ON' : '' }).catch(() => {})
  chrome.action.setBadgeBackgroundColor({ color: enabled ? '#10b981' : '#707579' }).catch(() => {})
}

// ---------------------------------------------------------------------------
// 代理挂载 / 摘除
// ---------------------------------------------------------------------------

function buildBypassList() {
  const list = ['<-loopback>']
  // edt 控制通道端口必须绕开自身代理（含扫描段全部端口，重连可能落在任意一个）
  for (let i = 0; i < WS_PORT_RANGE; i++) {
    list.push(`127.0.0.1:${WS_PORT_BASE + i}`)
    list.push(`localhost:${WS_PORT_BASE + i}`)
  }
  return list
}

async function applyProxy(proxyPort) {
  await chrome.proxy.settings.set({
    value: {
      mode: 'fixed_servers',
      rules: {
        singleProxy: { scheme: 'http', host: '127.0.0.1', port: proxyPort },
        bypassList: buildBypassList(),
      },
    },
    scope: PROXY_SCOPE,
  })
  setBadge(true)
  reportProxyState(true)
}

/** 仅撤掉“自己挂的”代理，不碰其它来源（企业策略 / 用户手动） */
async function removeProxy(reason) {
  try {
    const current = await chrome.proxy.settings.get({ incognito: false })
    if (current.levelOfControl === 'controlled_by_this_extension') {
      await chrome.proxy.settings.clear({ scope: PROXY_SCOPE })
    }
  } catch {
    // clear 失败也不阻塞；下次启用会覆盖
  }
  setBadge(false)
  reportProxyState(false, reason)
}

function reportProxyState(enabled, error) {
  sendToEdt({ type: 'proxy-state', enabled, error })
}

// ---------------------------------------------------------------------------
// 脚本注入（chrome.userScripts）
// ---------------------------------------------------------------------------

const USER_SCRIPT_ID_PREFIX = 'edt-'

function scriptSupported() {
  return Boolean(chrome.userScripts?.register)
}

let scriptsSyncChain = Promise.resolve()

/** 串行化同步：内部先全量注销再注册，并发调用会互相踩（窗口期脚本未注册） */
function syncUserScripts(scripts) {
  if (!scriptSupported()) return scriptsSyncChain
  scriptsSyncChain = scriptsSyncChain
    .then(() => syncUserScriptsNow(scripts))
    .catch((error) => {
      state.lastError = `脚本同步失败：${error.message}`
    })
  return scriptsSyncChain
}

async function syncUserScriptsNow(scripts) {
  const existing = await chrome.userScripts.getScripts()
  const ourIds = existing.filter(script => script.id.startsWith(USER_SCRIPT_ID_PREFIX)).map(script => script.id)
  if (ourIds.length) {
    await chrome.userScripts.unregister({ ids: ourIds })
  }
  const registrations = scripts
    .filter(script => script.enabled && Array.isArray(script.matches) && script.matches.length && script.code)
    .map(script => ({
      id: `${USER_SCRIPT_ID_PREFIX}${script.id}`,
      matches: script.matches,
      runAt: script.runAt || 'document_start',
      world: script.world === 'MAIN' ? 'MAIN' : 'USER_SCRIPT',
      js: [{ code: wrapUserScript(script) }],
    }))
  if (registrations.length) {
    try {
      await chrome.userScripts.register(registrations)
    } catch (error) {
      state.lastError = `脚本注册失败：${error.message}`
    }
  }
}

function wrapUserScript(script) {
  if (script.world === 'MAIN') return script.code
  // USER_SCRIPT（隔离世界）包一层错误回传；MAIN 世界无 chrome API，跳过
  const payload = JSON.stringify({ scriptId: script.id })
  return `try {\n${script.code}\n} catch (e) {\n  try { chrome.runtime.sendMessage({ type: 'script-log', meta: ${payload}, level: 'error', message: String((e && e.stack) || e) }); } catch (_) {}\n}\n`
}

// ---------------------------------------------------------------------------
// WS 连接
// ---------------------------------------------------------------------------

function tryConnectOnce(port) {
  return new Promise((resolve) => {
    let settled = false
    let socket
    try {
      socket = new WebSocket(`ws://127.0.0.1:${port}/`)
    } catch {
      resolve(null)
      return
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        socket.close()
      } catch {}
      resolve(null)
    }, CONNECT_TIMEOUT_MS)

    socket.onopen = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(socket)
    }
    socket.onerror = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(null)
    }
    socket.onclose = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(null)
    }
  })
}

function awaitHello(socket) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, HELLO_TIMEOUT_MS, { type: 'timeout' })
    const onMessage = (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      if (message.type === 'hello-ok' || message.type === 'hello-reject') {
        clearTimeout(timer)
        socket.removeEventListener('message', onMessage)
        resolve(message)
      }
    }
    socket.addEventListener('message', onMessage)
    socket.send(JSON.stringify({
      type: 'hello',
      appId: state.appId,
      clientId: state.clientId,
      version: state.version,
    }))
  })
}

async function connect() {
  // 注意用 isSocketAlive：state.connected 可能是僵死连接的残留标记，不能据此跳过重连
  if (isSocketAlive()) return
  if (state.connecting) return state.connecting
  if (state.connected) markDisconnected()

  state.connecting = (async () => {
    const settings = await getSettings()

    const start = settings.lastWsPort >= WS_PORT_BASE && settings.lastWsPort < WS_PORT_BASE + WS_PORT_RANGE
      ? settings.lastWsPort
      : WS_PORT_BASE

    for (let i = 0; i < WS_PORT_RANGE; i++) {
      const port = WS_PORT_BASE + ((start - WS_PORT_BASE + i) % WS_PORT_RANGE)
      const socket = await tryConnectOnce(port)
      if (!socket) continue

      const hello = await awaitHello(socket)
      if (hello.type === 'hello-reject') {
        state.lastError = hello.reason === 'bad-origin' ? '连接被拒绝：扩展来源校验未通过（版本不匹配？）' : `连接被拒绝（${hello.reason}）`
        try {
          socket.close()
        } catch {}
        await failOpenProxy()
        return
      }
      if (hello.type !== 'hello-ok') {
        try {
          socket.close()
        } catch {}
        continue
      }

      // 连接成功
      state.socket = socket
      state.connected = true
      state.lastMessageAt = Date.now()
      state.lastError = null
      state.wsPort = hello.wsPort || port
      state.proxyPort = hello.proxyPort || null
      state.targets = hello.targets || []
      state.scripts = hello.scripts || []
      state.rules = hello.rules || []
      await chrome.storage.local.set({ lastWsPort: port })

      socket.addEventListener('message', onSocketMessage)
      socket.addEventListener('close', onSocketClosed)
      socket.addEventListener('error', onSocketClosed)

      await syncUserScripts(state.scripts)
      if (settings.proxyEnabled && state.proxyPort) {
        // 重连后按本地开关重新挂载（edt 代理端口可能已变化）
        await applyProxy(state.proxyPort)
      } else {
        await failOpenProxy()
      }
      return
    }

    state.lastError = '未找到 edt 实例：请确认 everydaytool 正在运行'
    await failOpenProxy()
  })().finally(() => {
    state.connecting = null
  })

  return state.connecting
}

/** 断线 fail-open：已挂载则自动撤代理（保持等 popup 手动恢复会造成全浏览器断网假象） */
async function failOpenProxy() {
  const settings = await getSettings()
  if (settings.proxyEnabled) {
    await removeProxy('edt 连接断开，已自动恢复直连')
  } else {
    setBadge(false)
  }
}

function onSocketClosed() {
  state.connected = false
  state.socket = null
  state.lastMessageAt = 0
  setBadge(false)
  failOpenProxy().finally(() => {
    // SW 可能随时休眠，定时重连只作即时补偿；长期靠 alarm 兜底
    setTimeout(() => {
      connect().catch(() => {})
    }, 2000)
  })
}

async function disconnectManually() {
  try {
    state.socket?.close()
  } catch {}
  state.socket = null
  state.connected = false
  await removeProxy()
}

function sendToEdt(message) {
  if (isSocketAlive()) {
    try {
      state.socket.send(JSON.stringify(message))
      return true
    } catch {
      return false
    }
  }
  return false
}

/** 连接是否真的可用：SW 被冻结/恢复后 socket 可能已死，但 state.connected 还留着 true */
function isSocketAlive() {
  return state.connected && state.socket?.readyState === WebSocket.OPEN
}

function markDisconnected() {
  state.connected = false
  state.socket = null
}

/** SW 被回收后 state 会归零：popup 打开时先等一次重连，别让界面直接显示空名单 */
async function ensureConnected(timeoutMs = 1500) {
  if (isSocketAlive()) {
    // 心跳 20s 一次：超过 60s 一条消息都没收到，判定僵死并强制重连
    if (state.lastMessageAt && Date.now() - state.lastMessageAt > STALE_CONNECTION_MS) {
      try {
        state.socket?.close()
      } catch {}
      markDisconnected()
    } else {
      return true
    }
  } else if (state.connected) {
    markDisconnected()
  }

  if (!state.connecting) connect().catch(() => {})
  await Promise.race([
    (state.connecting || Promise.resolve()).then(() => undefined).catch(() => undefined),
    new Promise(resolve => setTimeout(resolve, timeoutMs)),
  ])
  return isSocketAlive()
}

/** 主动断开重连（拿到请求无响应时用：僵死连接 send 得出去但收不回来） */
async function forceReconnect(timeoutMs = 1500) {
  try {
    state.socket?.close()
  } catch {}
  markDisconnected()
  return ensureConnected(timeoutMs)
}

/** 等待 edt 回执的请求（requestId → resolve 回调） */
const pendingPopupRequests = new Map()

/**
 * 向 edt 发一条需要回执的消息：
 * - 解析成回执对象 = 成功；
 * - null = 发出去了但超时没回执；
 * - undefined = 连接不可用，根本没发出去。
 */
function requestFromEdt(buildMessage, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID()
    const timer = setTimeout(() => {
      pendingPopupRequests.delete(requestId)
      resolve(null)
    }, timeoutMs)
    pendingPopupRequests.set(requestId, (result) => {
      clearTimeout(timer)
      resolve(result)
    })
    if (!sendToEdt(buildMessage(requestId))) {
      clearTimeout(timer)
      pendingPopupRequests.delete(requestId)
      resolve(undefined)
    }
  })
}

// ---------------------------------------------------------------------------
// 站点视图本地兜底：edt 不回 site-info（旧版 edt / 链路异常）时，用已同步的
// targets / rules 在扩展侧做同样的域级过滤，保证弹窗不空白。
// ---------------------------------------------------------------------------

const TWO_LEVEL_SUFFIXES = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac'])

function registrableDomain(host) {
  const parts = String(host || '').toLowerCase().split('.')
  if (parts.length <= 2) return parts.join('.')
  if (TWO_LEVEL_SUFFIXES.has(parts[parts.length - 2])) return parts.slice(-3).join('.')
  return parts.slice(-2).join('.')
}

/** 从 URL 取 origin（默认端口省略，与 edt 的条目格式一致） */
function originOfUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}`
  } catch {
    return undefined
  }
}

/** 从 origin 取主机（`https://[::1]:8089` → `::1`） */
function originHostOf(origin) {
  try {
    return new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    return ''
  }
}

function localSourceHostPattern(rule) {
  const source = rule.source
  if (!source) return undefined
  const raw = String(source.value ?? '').trim()
  if (!raw) return undefined
  if (source.key === 'host') return raw
  if (source.key === 'url') {
    if (source.operator === 'matches') return undefined
    const byScheme = /^[a-z*]+:\/\/([^/?#]+)/i.exec(raw)
    if (byScheme?.[1]) return byScheme[1]
    if (!raw.includes('/') && /^[\w.*:-]+$/.test(raw) && raw.includes('.')) return raw
  }
  return undefined
}

function localHostMatchesPattern(pattern, host, operator) {
  const value = pattern.replace(/:\d+$/, '').toLowerCase()
  if (!value || value === '*') return true
  if (operator === 'matches') {
    try {
      return new RegExp(value).test(host)
    } catch {
      return false
    }
  }
  if (value.startsWith('*.')) {
    const base = value.slice(2)
    if (host === base || host.endsWith(`.${base}`)) return true
  }
  if (value.includes('*') || value.includes('?')) {
    const escaped = value.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
    if (new RegExp(`^${escaped}$`).test(host)) return true
  }
  if (operator === 'contains' && host.includes(value)) return true
  if (value === host) return true
  if (host.endsWith(`.${value}`) || value.endsWith(`.${host}`)) return true
  return registrableDomain(host) === registrableDomain(value)
}

function localRuleScope(rule, host) {
  const pattern = localSourceHostPattern(rule)
  if (pattern === undefined) return 'global'
  if (/^[\s*?:]*$/.test(pattern)) return 'global'
  return localHostMatchesPattern(pattern, host, rule.source?.operator) ? 'site' : null
}

function localSiteInfo(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return { targets: [], related: [], rules: [], total: state.targets.length }
  }
  const host = url.hostname.toLowerCase()
  const pageOrigin = originOfUrl(rawUrl)

  // 名单按 origin 精确匹配；同主机但协议 / 端口不同的条目放进 related（解释「为什么没生效」）
  const targets = []
  const related = []
  for (const target of state.targets) {
    if (target.origin === pageOrigin) targets.push(target)
    else if (originHostOf(target.origin) === host) related.push(target)
  }
  // 规则摘要带 source 才能按域筛；老版 edt 不带 → 全部列出（标 global）
  const rules = []
  for (const rule of state.rules) {
    const scope = rule.source ? localRuleScope(rule, host) : 'global'
    if (!scope) continue
    rules.push({ ...rule, scope })
  }
  rules.sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'site' ? -1 : 1))
  return { targets, related, rules, total: state.targets.length }
}

function onSocketMessage(event) {
  state.lastMessageAt = Date.now()
  let message
  try {
    message = JSON.parse(event.data)
  } catch {
    return
  }

  switch (message.type) {
    case 'heartbeat':
      // 收到即续命；回 pong 让 edt 侧也确认存活
      sendToEdt({ type: 'ping', at: Date.now() })
      return
    case 'targets-sync':
      state.targets = message.targets || []
      notifyPopupStateChanged()
      return
    case 'rules-sync':
      state.rules = message.rules || []
      notifyPopupStateChanged()
      return
    case 'scripts-sync':
      state.scripts = message.scripts || []
      syncUserScripts(state.scripts).catch(() => {})
      return
    case 'proxy-port': {
      // edt 侧改了代理端口：已挂载代理的浏览器必须立刻改指新端口
      state.proxyPort = message.proxyPort || null
      void (async () => {
        const settings = await getSettings()
        if (settings.proxyEnabled && state.proxyPort) await applyProxy(state.proxyPort)
        notifyPopupStateChanged()
      })()
      return
    }
    case 'set-proxy': {
      void (async () => {
        try {
          if (message.enabled && state.proxyPort) {
            await chrome.storage.local.set({ proxyEnabled: true })
            await applyProxy(state.proxyPort)
          } else {
            await chrome.storage.local.set({ proxyEnabled: false })
            await removeProxy()
          }
          notifyPopupStateChanged()
        } catch (error) {
          state.lastError = `代理设置失败：${error.message}`
          notifyPopupStateChanged()
        }
      })()
      return
    }
    case 'target-suggest-result':
    case 'site-info-result':
      respondToPopup(message)
  }
}

// ---------------------------------------------------------------------------
// popup 通信
// ---------------------------------------------------------------------------

function respondToPopup(message) {
  const pending = pendingPopupRequests.get(message.requestId)
  if (pending) {
    pending(message)
    pendingPopupRequests.delete(message.requestId)
  }
}

function notifyPopupStateChanged() {
  chrome.runtime.sendMessage({ type: 'popup-state-changed' }).catch(() => {})
}

async function buildPopupState() {
  const settings = await getSettings()
  return {
    connected: state.connected,
    connecting: Boolean(state.connecting),
    lastError: state.lastError,
    proxyEnabled: settings.proxyEnabled,
    proxyPort: state.proxyPort,
    wsPort: state.wsPort,
    appId: state.appId,
    scriptSupported: scriptSupported(),
    targets: state.targets,
    rules: state.rules,
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false

  if (message.type === 'script-log') {
    const meta = message.meta || {}
    sendToEdt({ type: 'script-log', scriptId: meta.scriptId || 'unknown', level: message.level || 'error', message: message.message || '' })
    return false
  }

  if (message.type === 'get-popup-state') {
    buildPopupState().then(sendResponse)
    return true
  }

  if (message.type === 'reconnect') {
    disconnectManually().then(() => connect()).then(() => sendResponse({ ok: true }))
    return true
  }

  if (message.type === 'set-proxy') {
    void (async () => {
      if (message.enabled) {
        if (!isSocketAlive() || !state.proxyPort) {
          sendResponse({ ok: false, error: '尚未连接 edt' })
          return
        }
        await chrome.storage.local.set({ proxyEnabled: true })
        await applyProxy(state.proxyPort)
        sendResponse({ ok: true })
      } else {
        await chrome.storage.local.set({ proxyEnabled: false })
        await removeProxy()
        sendResponse({ ok: true })
      }
    })()
    return true
  }

  if (message.type === 'add-target') {
    const ok = sendToEdt({ type: 'add-target', url: message.url })
    sendResponse({ ok, error: ok ? undefined : '尚未连接 edt' })
    return false
  }

  // 站点视图：当前站点命中的名单条目 + 规则（匹配在 edt 侧算；edt 不回则本地兜底）
  if (message.type === 'get-site-info') {
    void (async () => {
      const local = () => localSiteInfo(message.url)
      const connected = await ensureConnected(1200)
      if (!connected) {
        sendResponse({ ok: false, local: true, error: '尚未连接 edt（请确认 everydaytool 正在运行），以下为扩展本地数据', ...local() })
        return
      }

      let reply = await requestFromEdt(
        requestId => ({ type: 'site-info', requestId, url: message.url }),
        1500,
      )
      if (reply === undefined || reply === null) {
        // 发不出去 / 没回执：多半是连接僵死，重连后重试一次
        await forceReconnect(1500)
        reply = await requestFromEdt(
          requestId => ({ type: 'site-info', requestId, url: message.url }),
          1500,
        )
      }
      if (reply === undefined || reply === null) {
        sendResponse({
          ok: false,
          local: true,
          error: 'edt 未响应站点查询（edt 可能是旧版，请重启后重载扩展），以下为扩展本地数据',
          ...local(),
        })
        return
      }
      sendResponse({
        ok: true,
        targets: reply.targets || [],
        related: reply.related || [],
        rules: reply.rules || [],
        total: state.targets.length,
      })
    })()
    return true
  }

  if (message.type === 'toggle-target' || message.type === 'toggle-rule') {
    const ok = sendToEdt({
      type: message.type,
      id: message.id,
      enabled: message.enabled === true,
    })
    sendResponse({ ok, error: ok ? undefined : '尚未连接 edt' })
    return false
  }

  if (message.type === 'remove-target-id' || message.type === 'remove-rule') {
    const ok = sendToEdt({ type: message.type, id: message.id })
    sendResponse({ ok, error: ok ? undefined : '尚未连接 edt' })
    return false
  }

  if (message.type === 'suggest-targets') {
    void (async () => {
      if (!(await ensureConnected(1200))) {
        sendResponse({ ok: false, error: '尚未连接 edt', hosts: [] })
        return
      }
      const result = await requestFromEdt(
        requestId => ({ type: 'target-suggest', requestId, url: message.url }),
        1500,
      )
      sendResponse({ ok: Boolean(result), hosts: result?.hosts || [] })
    })()
    return true
  }

  return false
})

// ---------------------------------------------------------------------------
// 启动与重连兜底
// ---------------------------------------------------------------------------

// Chrome 对 periodInMinutes 有 1 分钟下限（写更小也会被收敛），如实按 1 分钟配
chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 })

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM && !isSocketAlive()) {
    connect().catch(() => {})
  }
})

chrome.runtime.onStartup.addListener(() => {
  connect().catch(() => {})
})

chrome.runtime.onInstalled.addListener(() => {
  connect().catch(() => {})
})

connect().catch(() => {})
