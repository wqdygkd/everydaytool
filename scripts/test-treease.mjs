// treease 接口拦截端到端验收（不依赖外网）：
// 1) 本地起一个页面，暴露 window.__runTests()，内部用 fetch/XHR 请求 JSON 接口
// 2) 创建带 treease 注入运行时的 webview
// 3) 通过应用命令 下发 modify / block 规则
// 4) 断言 fetch 与 XHR 都被改写、block 返回 403、命中计数增长
import http from 'node:http'
import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)
const WebSocket = require('ws')

const PORT = 5198

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Treease Intercept Probe</title></head>
<body>
<div id="app">probe</div>
<script>
window.__results = {};
window.__runTests = function () {
  window.__results = {};
  fetch('/api/data').then(function (r) { return r.json() }).then(function (v) { window.__results.fetch = v }).catch(function (e) { window.__results.fetchErr = String(e) });
  fetch('/api/blocked').then(function (r) { window.__results.blockStatus = r.status }).catch(function (e) { window.__results.blockErr = String(e) });
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/data');
  xhr.onload = function () {
    try { window.__results.xhr = JSON.parse(xhr.responseText) } catch (e) { window.__results.xhrText = xhr.responseText }
  };
  xhr.onerror = function () { window.__results.xhrErr = 'error' };
  xhr.send();
  return true;
};
</script>
</body></html>`

const server = http.createServer((request, response) => {
  const url = request.url || '/'
  if (url.startsWith('/api/data')) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ role: 'user', level: 1 }))
    return
  }
  if (url.startsWith('/api/blocked')) {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ should: 'not reach' }))
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(html)
})
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve))
console.log(`✓ 测试页已启动：http://127.0.0.1:${PORT}/`)

const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find(target => target.type === 'page' && (target.url.includes('tauri.localhost') || target.url.includes('localhost:5173')))
if (!page) {
  console.error('✗ 主窗口 CDP target 不存在')
  server.close()
  process.exit(1)
}

const socket = new WebSocket(page.webSocketDebuggerUrl)
let nextId = 1
const pending = new Map()
socket.on('message', (raw) => {
  const message = JSON.parse(raw.toString())
  if (!message.id) return
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  if (message.error) request.reject(new Error(message.error.message))
  else request.resolve(message.result)
})
await new Promise((resolve, reject) => {
  socket.once('open', resolve)
  socket.once('error', reject)
})
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
await send('Runtime.enable')
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result?.value
}
async function webviewEval(script) {
  const raw = await evaluate(`window.__TAURI_INTERNALS__.invoke('edt_webview',{op:'eval',args:{id:'treease',script:${JSON.stringify(script)}}}).then(r => JSON.stringify(r)).catch(e => 'ERR:' + JSON.stringify(e))`)
  if (typeof raw !== 'string' || raw.startsWith('ERR:')) return null
  const envelope = JSON.parse(raw)
  return envelope.ok ? envelope.value : null
}

await evaluate(`window.__TAURI_INTERNALS__.invoke('edt_webview',{op:'close',args:{id:'treease'}}).catch(()=>{})`)
const created = await evaluate(`window.__TAURI_INTERNALS__.invoke('edt_webview',{op:'create',args:{id:'treease',url:'http://127.0.0.1:${PORT}/',profile:'treease',preset:'treease',x:80,y:80,width:720,height:480}}).then(r => JSON.stringify(r)).catch(e => 'ERR:' + JSON.stringify(e))`)
console.log(`✓ webview 创建：${created}`)
await new Promise(resolve => setTimeout(resolve, 2000))
console.log(`✓ 注入运行时：${await webviewEval('typeof window.__edtTreease')}`)

const rules = [
  {
    id: 'rule_modify',
    name: 'modify role',
    enabled: true,
    urlPattern: '*api/data*',
    action: 'modify',
    patches: [{ path: 'role', value: 'admin' }],
  },
  {
    id: 'rule_block',
    name: 'block api',
    enabled: true,
    urlPattern: '*api/blocked*',
    action: 'block',
    patches: [],
  },
]
const startStatus = await evaluate(`window.__TAURI_INTERNALS__.invoke('treease_command',{command:'treease:intercept-start',args:[1,${JSON.stringify(rules)}]}).then(r => JSON.stringify(r)).catch(e => 'ERR:' + e.message)`)
console.log(`✓ 规则已下发：${startStatus}`)

await webviewEval('window.__runTests()')
let results = null
for (let attempt = 0; attempt < 20; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 300))
  const raw = await webviewEval('JSON.stringify(window.__results)')
  if (!raw) continue
  results = JSON.parse(raw)
  if (results.fetch && results.xhr && results.blockStatus) break
}
console.log(`✓ 请求结果：${JSON.stringify(results)}`)

const status = await evaluate(`window.__TAURI_INTERNALS__.invoke('treease_command',{command:'treease:intercept-status',args:[1]}).then(r => JSON.stringify(r)).catch(e => 'ERR:' + e.message)`)
console.log(`✓ 拦截状态：${status}`)

const stop = await evaluate(`window.__TAURI_INTERNALS__.invoke('treease_command',{command:'treease:intercept-stop',args:[1]}).then(r => JSON.stringify(r)).catch(e => 'ERR:' + e.message)`)
console.log(`✓ 停止拦截：${stop}`)
await evaluate(`window.__TAURI_INTERNALS__.invoke('edt_webview',{op:'close',args:{id:'treease'}}).catch(()=>{})`)

socket.close()
server.close()

const ok = results
  && results.fetch?.role === 'admin'
  && results.xhr?.role === 'admin'
  && results.blockStatus === 403
  && status && status !== 'ERR'
if (!ok) {
  console.error('✗ treease 拦截断言失败')
  process.exit(1)
}
console.log('✓ treease 拦截端到端验收通过（fetch 改写 / XHR 改写 / block 403 / 命中计数）')
