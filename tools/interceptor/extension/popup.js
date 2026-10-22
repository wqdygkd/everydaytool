// edt 拦截器 popup：连接状态 / 代理开关 / 当前站点的名单条目与命中规则（可禁用、可移除）/ 相关域名提示
'use strict'

const els = {
  statusDot: document.getElementById('status-dot'),
  errorBox: document.getElementById('error-box'),
  errorText: document.getElementById('error-text'),
  reconnect: document.getElementById('reconnect'),
  connState: document.getElementById('conn-state'),
  proxyPort: document.getElementById('proxy-port'),
  proxyToggle: document.getElementById('proxy-toggle'),
  currentHost: document.getElementById('current-host'),
  addOrigin: document.getElementById('add-origin'),
  targetCount: document.getElementById('target-count'),
  listRefresh: document.getElementById('list-refresh'),
  targetHint: document.getElementById('target-hint'),
  targetList: document.getElementById('target-list'),
  relatedWrap: document.getElementById('related-wrap'),
  relatedList: document.getElementById('related-list'),
  ruleCount: document.getElementById('rule-count'),
  ruleHint: document.getElementById('rule-hint'),
  ruleList: document.getElementById('rule-list'),
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

  const showError = Boolean(state.lastError) || (!state.connected && !state.connecting)
  els.errorBox.classList.toggle('hidden', !showError)
  if (state.lastError) els.errorText.textContent = state.lastError
  else if (showError) els.errorText.textContent = '未检测到 edt：请确认 everydaytool 正在运行（无需任何配置，连上后打开下面的开关即可）。'

  if (!state.scriptSupported) {
    els.suggestSection.classList.add('hidden')
  }
}

// ---------------------------------------------------------------------------
// 条目渲染（名单 / 规则共用一套行样式）
// ---------------------------------------------------------------------------

function buildRow({ title, mono, tags, enabled, onToggle, onRemove }) {
  const li = document.createElement('li')
  li.className = 'entry'

  const main = document.createElement('div')
  main.className = 'entry-main'

  const name = document.createElement('span')
  name.textContent = title
  if (mono) name.className = 'mono entry-title'
  else name.className = 'entry-title'
  main.appendChild(name)

  for (const tag of tags) {
    const span = document.createElement('span')
    span.className = `tag${tag.tone ? ` tag-${tag.tone}` : ''}`
    span.textContent = tag.text
    main.appendChild(span)
  }

  const actions = document.createElement('div')
  actions.className = 'entry-actions'

  const label = document.createElement('label')
  label.className = 'switch switch-sm'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = enabled
  input.addEventListener('change', () => onToggle(input.checked))
  const slider = document.createElement('span')
  slider.className = 'slider'
  label.append(input, slider)

  const remove = document.createElement('button')
  remove.className = 'btn btn-danger btn-sm'
  remove.textContent = '移除'
  remove.addEventListener('click', onRemove)

  actions.append(label, remove)
  li.append(main, actions)
  return li
}

function renderEmpty(listEl, text) {
  listEl.innerHTML = ''
  const li = document.createElement('li')
  li.className = 'muted'
  li.textContent = text
  listEl.appendChild(li)
}

function targetTitle(target) {
  return String(target?.origin ?? '').trim()
}

function targetTags(target, dimmed) {
  return [
    ...(dimmed ? [{ text: '未命中', tone: 'plain' }] : []),
    ...(target.enabled === false ? [{ text: '已禁用', tone: 'plain' }] : []),
  ]
}

function targetRow(target, dimmed) {
  return buildRow({
    title: targetTitle(target),
    mono: true,
    tags: targetTags(target, dimmed),
    enabled: target.enabled !== false,
    onToggle: async (enabled) => {
      await send({ type: 'toggle-target', id: target.id, enabled })
      setTimeout(refreshSiteLists, 250)
    },
    onRemove: async () => {
      await send({ type: 'remove-target-id', id: target.id })
      setTimeout(refreshSiteLists, 250)
    },
  })
}

function renderTargets(info) {
  const targets = info?.targets || []
  const related = info?.related || []
  const total = typeof info?.total === 'number' ? info.total : targets.length + related.length

  els.targetCount.textContent = total ? `（本站 ${targets.length} / 共 ${total}）` : ''

  if (!targets.length) {
    renderEmpty(els.targetList, info?.error || '当前站点未命中名单')
  } else {
    els.targetList.innerHTML = ''
    for (const target of targets) els.targetList.appendChild(targetRow(target, false))
  }

  // 同域但没命中的条目：显示出来，用户才知道自己配的那条为什么没生效
  const showRelated = related.length > 0
  els.relatedWrap.classList.toggle('hidden', !showRelated)
  if (showRelated) {
    els.relatedList.innerHTML = ''
    for (const target of related) els.relatedList.appendChild(targetRow(target, true))
  }

  const hint = info?.error
    ? info.error
    : (!targets.length && total > 0 ? `名单里有 ${total} 条配置，但都不匹配当前站点。` : '')
  els.targetHint.textContent = hint
  els.targetHint.classList.toggle('hidden', !hint)
}
function renderRules(rules, hint) {
  els.ruleCount.textContent = rules.length ? `（${rules.length}）` : ''
  const text = hint || ''
  els.ruleHint.textContent = text
  els.ruleHint.classList.toggle('hidden', !text)
  if (!rules.length) {
    renderEmpty(els.ruleList, '该站点没有可用规则')
    return
  }
  els.ruleList.innerHTML = ''
  for (const rule of rules) {
    els.ruleList.appendChild(buildRow({
      title: rule.name || '未命名规则',
      tags: [
        { text: rule.scope === 'global' ? '全局' : '本站', tone: rule.scope === 'global' ? 'plain' : 'ok' },
        { text: rule.typeLabel || rule.type, tone: 'plain' },
        { text: rule.condition, tone: 'muted' },
        ...(rule.enabled === false ? [{ text: '已禁用', tone: 'plain' }] : []),
      ],
      enabled: rule.enabled !== false,
      onToggle: async (enabled) => {
        await send({ type: 'toggle-rule', id: rule.id, enabled })
        setTimeout(refreshSiteLists, 250)
      },
      onRemove: async () => {
        await send({ type: 'remove-rule', id: rule.id })
        setTimeout(refreshSiteLists, 250)
      },
    }))
  }
}

async function refreshSiteLists() {
  if (!currentUrl) {
    els.targetCount.textContent = ''
    els.ruleCount.textContent = ''
    els.relatedWrap.classList.add('hidden')
    els.targetHint.classList.add('hidden')
    els.ruleHint.classList.add('hidden')
    renderEmpty(els.targetList, '当前标签不是网页')
    renderEmpty(els.ruleList, '当前标签不是网页')
    return
  }
  let info
  try {
    info = await send({ type: 'get-site-info', url: currentUrl })
  } catch (error) {
    info = { ok: false, error: `站点查询失败：${error?.message || '未知错误'}`, targets: [], related: [], rules: [] }
  }
  if (!info) info = {}

  renderTargets(info)
  renderRules(info.rules || [], info.local && info.error ? `${info.error}（规则未按域过滤）` : '')
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
      await send({ type: 'add-target', url: `http://${host}/`, key: 'host', operator: 'equals' })
      setTimeout(refreshSiteLists, 250)
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
      // 显示的就是要加入名单的 origin（协议 + 主机 + 非默认端口）
      const url = new URL(currentUrl)
      els.currentHost.textContent = `${url.protocol}//${url.host}`
    } catch {
      els.currentHost.textContent = '—'
    }
    setAddButtonsDisabled(false)
    await refreshSiteLists()
    await refreshSuggestions()
  } else {
    els.currentHost.textContent = '当前标签不是网页'
    setAddButtonsDisabled(true)
    await refreshSiteLists()
  }
}

function setAddButtonsDisabled(disabled) {
  els.addOrigin.disabled = disabled
}

els.reconnect.addEventListener('click', async () => {
  await send({ type: 'reconnect' })
  setTimeout(refresh, 1500)
})

els.listRefresh.addEventListener('click', async () => {
  els.listRefresh.disabled = true
  els.listRefresh.textContent = '刷新中…'
  await send({ type: 'reconnect' })
  await refresh()
  els.listRefresh.disabled = false
  els.listRefresh.textContent = '重连并刷新'
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

/** 一键把当前页面加入名单：名单只按 origin（协议 + 域名 + 端口）判定，路径交给 edt 里的规则 */
async function addCurrentSite() {
  if (!currentUrl) return
  const result = await send({ type: 'add-target', url: currentUrl })
  if (result?.ok) setTimeout(refreshSiteLists, 300)
}

els.addOrigin.addEventListener('click', () => addCurrentSite())

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'popup-state-changed') refresh()
  return false
})

refresh()
