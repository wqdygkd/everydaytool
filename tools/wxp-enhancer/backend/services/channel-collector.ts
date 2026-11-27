import type { WxpChannelTogglePayload } from '../../../../shared/wxp.ts'

/**
 * 转发通道（链接中心）注入表达式：在 WXP 主页面里读医院 / 转发列表 / 通道端口，
 * 以及建立、关闭通道。和 data-collector 的采集表达式一样以字符串注入页面执行：
 *
 * - **表达式内部禁止反斜杠转义**（模板字符串会把 `\s` 吞成 `s`），因此不使用正则字面量；
 * - 表达式内部只用 ES5 + async/await（Chromium 126 原生支持），不引用任何模块作用域；
 * - 拼进表达式的值一律经 `quote()` 白名单校验，避免引号 / 反斜杠破坏脚本。
 *
 * 通道状态的唯一事实来源是 WXP 主进程的 `listenNodes`：页面侧只能通过
 * `app/ProxyServerAllEnabledPorts`（→ `getPortsByTenant`）读到端口集合。
 */

/** 把字符串安全地拼进表达式：拒绝引号、反斜杠与控制字符 */
function quote(value: string): string {
  const text = typeof value === 'string' ? value : ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '"' || ch === '\\' || text.charCodeAt(i) < 32) {
      throw new Error('通道参数包含非法字符')
    }
  }
  return `"${text}"`
}

/**
 * 通道快照：医院列表 + WXP 当前医院 + 端口集合；`includeLinks` 为真时再拉一次
 * `suit/getByUserAndBranch` 转发列表（服务端有 30s 缓存，轮询时不必每次都拉）。
 *
 * @param hospitalCode 目标医院；空串表示跟随 WXP 当前医院
 */
export function buildChannelSnapshotExpression(hospitalCode: string, includeLinks: boolean): string {
  const codeLiteral = quote(hospitalCode)
  return `(async function () {
  var out = { hospitals: [], currentCode: '', hospitalCode: '', links: [], onlinePorts: [], error: '' }
  var vm = (document.getElementById('app') || {}).__vue__
  var store = vm && vm.$store
  if (!store) { out.error = '未找到 WXP 页面状态，请确认已登录并停在主页'; return out }
  try {
    var tenants = store.getters.tenants || []
    var current = store.getters.currentTenant || null
    out.currentCode = current ? String(current.code || '') : ''
    for (var i = 0; i < tenants.length; i += 1) {
      var tenant = tenants[i] || {}
      out.hospitals.push({
        code: String(tenant.code || ''),
        name: String(tenant.name || tenant.code || ''),
        branchid: String(tenant.branchid || '')
      })
    }
  } catch (e) {}
  var code = ${codeLiteral} || out.currentCode
  out.hospitalCode = code
  if (!code) { out.error = '请先选择医院'; return out }
  try {
    var ports = await store.dispatch('app/ProxyServerAllEnabledPorts', code)
    out.onlinePorts = Array.isArray(ports) ? ports : []
  } catch (e) {
    out.error = '读取通道状态失败：' + String((e && e.message) || e)
  }
  if (!${includeLinks}) return out
  try {
    var base = String(store.getters.baseURL || '')
    if (!base) throw new Error('缺少服务地址')
    var user = store.getters.user || {}
    var branchid = ''
    for (var j = 0; j < out.hospitals.length; j += 1) {
      if (out.hospitals[j].code === code) branchid = out.hospitals[j].branchid
    }
    var url = base + 'suit/getByUserAndBranch?usercode=' + encodeURIComponent(String(user.code || '')) + '&idBranch=' + encodeURIComponent(branchid)
    var timeout = new Promise(function (resolve, reject) {
      setTimeout(function () { reject(new Error('接口超时')) }, 4000)
    })
    var body = await Promise.race([
      fetch(url).then(function (res) { return res.json() }),
      timeout
    ])
    var list = (body && body.data) || (Array.isArray(body) ? body : [])
    for (var k = 0; k < list.length; k += 1) {
      var item = list[k] || {}
      var localIp = String(item.middle_ip || '')
      var localPort = Number(item.middle_port) || 0
      var rawName = String(item.name || '')
      var simpleName = rawName.split('(转发')[0] || rawName
      var rawProtocol = String(item.protocol || '')
      out.links.push({
        id: String(item.id == null ? '' : item.id),
        name: rawName,
        simpleName: simpleName,
        sceneformal: item.sceneformal ? '[正式]' : '[非正式]',
        accessPoint: localIp + ':' + String(item.middle_port == null ? '' : item.middle_port),
        targetPoint: String(item.middle_realip || '') + ':' + String(item.middle_realport == null ? '' : item.middle_realport),
        localIp: localIp,
        localPort: localPort,
        relIp: String(item.middle_realip || ''),
        relPort: Number(item.middle_realport) || 0,
        browsetype: String(item.browsetype || ''),
        operaPort: Number(item.opera_port) || 0,
        protocol: rawProtocol.indexOf('https') === -1 ? 'http' : 'https',
        urlSuffix: String(item.url_suffix || ''),
        canOpen: localIp === '127.0.0.1' || localIp === 'localhost',
        online: out.onlinePorts.indexOf(localPort) !== -1
      })
    }
  } catch (e) {
    out.error = (out.error ? out.error + ' / ' : '') + '读取转发列表失败：' + String((e && e.message) || e)
  }
  return out
})()`
}

/**
 * 建立 / 关闭一条通道。关键点：
 *
 * - 建立前必须先 `BindCurrentProxyTenant`：主进程 `startProxyNodeServer` 在
 *   `this.tenant && this.tenant != 租户` 时**静默 return**，不报错也不发事件；
 * - 租户传的是医院 `code`（不是 id / 名称），否则会建在 WXP 永远不查的 key 下；
 * - 操作完把主进程租户**还原**成 WXP 里当前选中的医院，避免打断用户在 WXP 上继续建通道；
 * - 结果以端口集合为准轮询确认（`GenerateProxyServerSync` 的 dispatch 不等监听就绪）。
 *
 * @param payload 医院 code 与一行转发连接
 * @param action open = 建立，close = 关闭
 */
export function buildChannelToggleExpression(payload: WxpChannelTogglePayload, action: 'open' | 'close'): string {
  const codeLiteral = quote(payload.hospitalCode)
  const idLiteral = quote(payload.link.id)
  const localIpLiteral = quote(payload.link.localIp)
  const relIpLiteral = quote(payload.link.relIp)
  const port = Math.round(payload.link.localPort)
  const relPort = Math.round(payload.link.relPort) || 0
  const wantOnline = action === 'open'
  return `(async function () {
  var out = { ok: false, already: false, ports: [], message: '' }
  var vm = (document.getElementById('app') || {}).__vue__
  var store = vm && vm.$store
  if (!store) { out.message = '未找到 WXP 页面状态，请确认已登录并停在主页'; return out }
  var code = ${codeLiteral}
  var port = ${port}
  var wantOnline = ${wantOnline}
  var restore = ''
  try { restore = (store.getters.currentTenant && store.getters.currentTenant.code) || '' } catch (e) {}
  var getPorts = async function () {
    try {
      var list = await store.dispatch('app/ProxyServerAllEnabledPorts', code)
      return Array.isArray(list) ? list : []
    } catch (e) { return [] }
  }
  var finish = async function () {
    try { await store.dispatch('app/BindCurrentProxyTenant', restore) } catch (e) {}
    return out
  }
  out.ports = await getPorts()
  var present = out.ports.indexOf(port) !== -1
  if (present === wantOnline) { out.ok = true; out.already = true; return finish() }
  if (wantOnline) {
    await store.dispatch('app/BindCurrentProxyTenant', code)
    await new Promise(function (resolve) { setTimeout(resolve, 200) })
    await store.dispatch('app/GenerateProxyServerSync', {
      suite: { id: ${idLiteral}, middle_ip: ${localIpLiteral}, middle_realip: ${relIpLiteral}, middle_realport: ${relPort}, middle_port: port },
      tenant: { code: code }
    })
  } else {
    await store.dispatch('app/CloseProxyServer', { port: port, tenantName: code })
  }
  var deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    await new Promise(function (resolve) { setTimeout(resolve, 250) })
    out.ports = await getPorts()
    var online = out.ports.indexOf(port) !== -1
    if (online === wantOnline) { out.ok = true; return finish() }
  }
  out.message = wantOnline
    ? '通道未在 5 秒内建立：请确认已登录、NameNode 已连接，且接入点为 localhost'
    : '通道未在 5 秒内关闭'
  return finish()
})()`
}
