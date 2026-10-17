// edt 浏览器桥 popup：连接状态 / 配对码 / 当前站点加入·移出名单 / 相关域名提示 / 代理开关（逃生）
'use strict'

const els = {
  statusDot: document.getElementById('status-dot'),
  errorBox: document.getElementById('error-box'),
  errorText: document.getElementById('error-text'),
  tokenInput: document.getElementById('token-input'),
  tokenSave: document.getElementById('token-save'),
  reconnect: document.getElementById('reconnect'),
  connState: document.getElementById('conn-state'),
  proxyPort: document.getElementById('proxy-port'),
  proxyToggle: document.getElementById('proxy-toggle'),
  currentHost: document.getElementById('current-host'),
  addExact: document.getElementById('add-exact'),
  addSuffix: document.getElementById('add-suffix'),
  removeTarget: document.getElementById('remove-target'),
  suggestSection: document.getElementById('suggest-section'),
  suggestList: document.getElementById('suggest-list'),
}

let currentUrl = null
let currentState = null

function send(message) {
  return chrome.runtime.sendMessage(message)
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

function renderState(state) {
  currentState = state

  els.statusDot.className = `dot ${state.connected ? 'dot-on' : state.connecting ? 'dot-warn' : 'dot-off'}`
  if (state.connected) {
    els.connState.textContent = `已连接（${state.appId}）`
    els.connState.classList.remove('muted')
  } else if (state.connecting) {
    els.connState.textContent = '连接中…'
    els.connState.classList.add('muted')
  } else {
    els.connState.textContent = '未连接'
    els.connState.classList.add('muted')
  }

  els.proxyPort.textContent = state.proxyPort ? String(state.proxyPort) : '—'
  els.proxyToggle.checked = Boolean(state.proxyEnabled)
  els.proxyToggle.disabled = !state.connected && !state.proxyEnabled

  const showError = Boolean(state.lastError) || !state.hasToken
  els.errorBox.classList.toggle('hidden', !showError)
  if (state.lastError) els.errorText.textContent = state.lastError
  else if (!state.hasToken) els.errorText.textContent = '首次使用：请把 edt「浏览器桥」页面的配对码填到这里。'

  if (!state.scriptSupported) {
    els.suggestSection.classList.add('hidden')
  }
}

async function refreshTargetButtons() {
  if (!currentUrl) return
  const result = await send({ type: 'check-target', url: currentUrl })
  const matched = result?.targets || []
  els.removeTarget.classList.toggle('hidden', matched.length === 0)
  els.addExact.disabled = false
  els.addSuffix.disabled = false

  if (matched.length > 0) {
    const first = matched[0]
    els.removeTarget.dataset.host = first.host
    els.removeTarget.dataset.port = first.port ?? ''
    els.removeTarget.dataset.targetId = first.id
  }
}

async function refreshSuggestions() {
  if (!currentUrl || !currentState?.connected) return
  const result = await send({ type: 'suggest-targets', url: currentUrl })
  const hosts = (result?.hosts || []).filter((host) => {
    try {
      const hostname = new URL(currentUrl).hostname
      return host !== hostname
    } catch {
      return true
    }
  })

  els.suggestList.innerHTML = ''
  if (!hosts.length) {
    const li = document.createElement('li')
    li.className = 'muted'
    li.textContent = '暂无（先让页面产生一些经过 edt 的请求）'
    els.suggestList.appendChild(li)
    return
  }
  for (const host of hosts.slice(0, 8)) {
    const li = document.createElement('li')
    const span = document.createElement('span')
    span.textContent = host
    const button = document.createElement('button')
    button.className = 'suggest-add'
    button.textContent = '+ 加入'
    button.addEventListener('click', async () => {
      await send({ type: 'add-target', url: `http://${host}/`, matchType: 'exact' })
      setTimeout(refreshTargetButtons, 200)
    })
    li.append(span, button)
    els.suggestList.appendChild(li)
  }
}

async function refresh() {
  let state
  try {
    state = await send({ type: 'get-popup-state' })
  } catch {
    // SW 无响应（极端情况）：保持现状，不抛未处理拒绝
    return
  }
  if (!state) return
  renderState(state)

  const tab = await getActiveTab()
  currentUrl = tab?.url && /^https?:/.test(tab.url) ? tab.url : null
  if (currentUrl) {
    try {
      els.currentHost.textContent = new URL(currentUrl).host
    } catch {
      els.currentHost.textContent = '—'
    }
    els.addExact.disabled = false
    els.addSuffix.disabled = false
    await refreshTargetButtons()
    await refreshSuggestions()
  } else {
    els.currentHost.textContent = '当前标签不是网页'
    els.addExact.disabled = true
    els.addSuffix.disabled = true
    els.removeTarget.classList.add('hidden')
  }
}

els.tokenSave.addEventListener('click', async () => {
  const token = els.tokenInput.value.trim()
  if (!token) return
  await send({ type: 'set-token', token })
  setTimeout(refresh, 1500)
})

els.reconnect.addEventListener('click', async () => {
  await send({ type: 'reconnect' })
  setTimeout(refresh, 1500)
})

els.proxyToggle.addEventListener('change', async () => {
  const result = await send({ type: 'set-proxy', enabled: els.proxyToggle.checked })
  if (result && result.ok === false) {
    els.proxyToggle.checked = false
    els.errorBox.classList.remove('hidden')
    els.errorText.textContent = result.error || '操作失败'
    return
  }
  setTimeout(refresh, 400)
})

els.addExact.addEventListener('click', async () => {
  if (!currentUrl) return
  const result = await send({ type: 'add-target', url: currentUrl, matchType: 'exact' })
  if (result?.ok) setTimeout(refreshTargetButtons, 300)
})

els.addSuffix.addEventListener('click', async () => {
  if (!currentUrl) return
  const result = await send({ type: 'add-target', url: currentUrl, matchType: 'suffix' })
  if (result?.ok) setTimeout(refreshTargetButtons, 300)
})

els.removeTarget.addEventListener('click', async () => {
  const host = els.removeTarget.dataset.host
  const port = els.removeTarget.dataset.port ? Number(els.removeTarget.dataset.port) : undefined
  if (!host) return
  const result = await send({ type: 'remove-target', host, port })
  if (result?.ok) setTimeout(refreshTargetButtons, 300)
})

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'popup-state-changed') refresh()
  return false
})

refresh()
