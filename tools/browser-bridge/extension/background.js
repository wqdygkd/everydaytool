// edt 浏览器桥扩展 service worker：
// - WS 客户端：59763 起端口段扫描 → hello 配对（token）→ 心跳/自动重连（对 Requestly 短板的补齐）；
// - 代理控制：chrome.proxy fixed_servers（B 模式）+ 自有端口 bypass（避免 WS 被自身代理圈进）；
//   fail-open：断线自动撤代理（Requestly 实践）；
// - 名单/脚本：全部状态来自 edt（targets-sync / scripts-sync），扩展只回传动作与状态；
// - 脚本注入：chrome.userScripts 动态注册（支持任意代码正文，需开发者模式——unpacked 场景天然满足）。
'use strict'

const WS_PORT_BASE = 59763
const WS_PORT_RANGE = 5
const RECONNECT_ALARM = 'edt-bridge-reconnect'
const CONNECT_TIMEOUT_MS = 1200
const HELLO_TIMEOUT_MS = 3000
const PROXY_SCOPE = 'regular'

/** @type {{socket: WebSocket|null, connected: boolean, connecting: Promise<void>|null, wsPort: number|null, proxyPort: number|null, targets: Array<object>, scripts: Array<object>, lastError: string|null, appId: string, clientId: string, version: string}} */
const state = {
  socket: null,
  connected: false,
  connecting: null,
  wsPort: null,
  proxyPort: null,
  targets: [],
  scripts: [],
  lastError: null,
  appId: detectAppId(),
  clientId: '',
  version: chrome.runtime.getManifest().version,
}

function detectAppId() {
  const ua = globalThis.navigator?.userAgent || ''
  if (/Edg\//.test(ua)) return 'existing-edge'
  if (/OPR\//.test(ua)) return 'existing-opera'
  if (/Brave/.test(ua)) return 'existing-brave'
  return 'existing-chrome'
}

async function getSettings() {
  const data = await chrome.storage.local.get({ token: '', proxyEnabled: false, lastWsPort: 0, clientId: '' })
  if (!data.clientId) {
    data.clientId = crypto.randomUUID()
    await chrome.storage.local.set({ clientId: data.clientId })
  }
  state.clientId = data.clientId
  return data
}

function setBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? 'ON' : '' }).catch(() => {})
  chrome.action.setBadgeBackgroundColor({ color: enabled ? '#00c73e' : '#707579' }).catch(() => {})
}

// ---------------------------------------------------------------------------
// 代理挂载 / 摘除
// ---------------------------------------------------------------------------

function buildBypassList() {
  const list = ['<-loopback>']
  // edt 桥端口必须绕开自身代理（含扫描段全部端口，重连可能落在任意一个）
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

function awaitHello(socket, token) {
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
      token,
      appId: state.appId,
      clientId: state.clientId,
      version: state.version,
    }))
  })
}

async function connect() {
  if (state.connected) return
  if (state.connecting) return state.connecting

  state.connecting = (async () => {
    const settings = await getSettings()
    if (!settings.token) {
      state.lastError = '未配置配对码：请从 edt 浏览器桥页面复制后填入'
      await failOpenProxy()
      return
    }

    const start = settings.lastWsPort >= WS_PORT_BASE && settings.lastWsPort < WS_PORT_BASE + WS_PORT_RANGE
      ? settings.lastWsPort
      : WS_PORT_BASE

    for (let i = 0; i < WS_PORT_RANGE; i++) {
      const port = WS_PORT_BASE + ((start - WS_PORT_BASE + i) % WS_PORT_RANGE)
      const socket = await tryConnectOnce(port)
      if (!socket) continue

      const hello = await awaitHello(socket, settings.token)
      if (hello.type === 'hello-reject') {
        state.lastError = hello.reason === 'bad-token' ? '配对码错误：请与 edt 页面显示的一致' : `连接被拒绝（${hello.reason}）`
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
      state.lastError = null
      state.wsPort = hello.wsPort || port
      state.proxyPort = hello.proxyPort || null
      state.targets = hello.targets || []
      state.scripts = hello.scripts || []
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
  if (state.socket?.readyState === WebSocket.OPEN) {
    try {
      state.socket.send(JSON.stringify(message))
      return true
    } catch {
      return false
    }
  }
  return false
}

function onSocketMessage(event) {
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
    case 'scripts-sync':
      state.scripts = message.scripts || []
      syncUserScripts(state.scripts).catch(() => {})
      return
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
      respondToPopup(message)
  }
}

// ---------------------------------------------------------------------------
// popup 通信
// ---------------------------------------------------------------------------

const pendingPopupRequests = new Map()

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

function targetMatchesUrl(target, url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  const port = parsed.port ? Number(parsed.port) : undefined
  if (target.port !== undefined && target.port !== port) return false
  const targetHost = (target.host || '').toLowerCase()
  if (target.matchType === 'suffix') return host === targetHost || host.endsWith(`.${targetHost}`)
  if (target.matchType === 'regex') {
    try {
      return new RegExp(target.host).test(host)
    } catch {
      return false
    }
  }
  return targetHost === host
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
    hasToken: Boolean(settings.token),
    targets: state.targets,
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

  if (message.type === 'set-token') {
    void chrome.storage.local.set({ token: String(message.token || '').trim(), lastWsPort: 0 }).then(() => {
      disconnectManually().then(() => connect())
      sendResponse({ ok: true })
    })
    return true
  }

  if (message.type === 'reconnect') {
    disconnectManually().then(() => connect()).then(() => sendResponse({ ok: true }))
    return true
  }

  if (message.type === 'set-proxy') {
    void (async () => {
      if (message.enabled) {
        if (!state.connected || !state.proxyPort) {
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
    const ok = sendToEdt({ type: 'add-target', url: message.url, matchType: message.matchType || 'exact' })
    sendResponse({ ok, error: ok ? undefined : '尚未连接 edt' })
    return false
  }

  if (message.type === 'remove-target') {
    const ok = sendToEdt({ type: 'remove-target', host: message.host, port: message.port })
    sendResponse({ ok, error: ok ? undefined : '尚未连接 edt' })
    return false
  }

  if (message.type === 'suggest-targets') {
    if (!state.connected) {
      sendResponse({ ok: false, error: '尚未连接 edt', hosts: [] })
      return false
    }
    const requestId = crypto.randomUUID()
    pendingPopupRequests.set(requestId, result => sendResponse({ ok: true, hosts: result.hosts || [] }))
    sendToEdt({ type: 'target-suggest', requestId, url: message.url })
    return true
  }

  if (message.type === 'check-target') {
    const matching = state.targets.filter(target => targetMatchesUrl(target, message.url))
    sendResponse({ ok: true, targets: matching })
    return false
  }

  return false
})

// ---------------------------------------------------------------------------
// 启动与重连兜底
// ---------------------------------------------------------------------------

// Chrome 对 periodInMinutes 有 1 分钟下限（写更小也会被收敛），如实按 1 分钟配
chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 })

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM && !state.connected) {
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
