// 无 GUI 环境下的桥接集成测试：
// 启动 Node 业务运行时（与 Rust 宿主完全相同的 stdio 协议），逐命令调用并断言结果，
// 用于在没有桌面会话的 CI/沙箱中验证命令层是否真正可用。
// 用法：node scripts/test-sidecar.mjs
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const hostEntry = path.join(rootDir, 'dist-sidecar/main.mjs')

const userData = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'everydaytool')
  : path.join(rootDir, '.test-user-data')

const child = spawn(process.execPath, [hostEntry], {
  cwd: rootDir,
  env: {
    ...process.env,
    EDT_IS_PACKAGED: '0',
    EDT_USER_DATA: userData,
    EDT_APP_ROOT: rootDir,
    EDT_RESOURCES: rootDir,
    EDT_APP_VERSION: '1.1.0',
    NODE_ENV: 'development',
  },
  stdio: ['pipe', 'pipe', 'inherit'],
})

let nextId = 1
const pending = new Map()
let readyResolve
const ready = new Promise(resolve => (readyResolve = resolve))

child.stdout.setEncoding('utf8')
let buffer = ''
child.stdout.on('data', (chunk) => {
  buffer += chunk
  let index
  // eslint-disable-next-line no-cond-assign
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    const message = JSON.parse(line)
    if (message.kind === 'ready') {
      readyResolve()
      continue
    }
    if (message.kind === 'response') {
      const request = pending.get(message.id)
      if (!request) continue
      pending.delete(message.id)
      if (message.ok) request.resolve(message.result)
      else request.reject(new Error(message.error))
      continue
    }
    if (message.kind === 'event') {
      console.log(`[event] ${message.channel}`)
    }
  }
})

function invoke(domain, command, args = []) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ kind: 'invoke', id, domain, command, args })}\n`)
  })
}

const timeout = setTimeout(() => {
  console.error('✗ 等待 Node 运行时 ready 超时')
  child.kill()
  process.exit(1)
}, 60_000)

await ready
clearTimeout(timeout)

const cases = [
  ['edtApp', 'edt-app:data-directory:get', []],
  ['edtApp', 'edt-app:data-usage:get', []],
  ['chromeSandbox', 'sandbox:get-all', []],
  ['chromeSandbox', 'config:get', []],
  ['envBrowser', 'env-browser:get-all', []],
  ['interceptor', 'interceptor:status:get', []],
  ['interceptor', 'interceptor:rules:get', []],
  ['wxpEnhancer', 'wxp:get-all', []],
  ['offlinePack', 'offline-pack:history:list', []],
]

let failed = 0
for (const [domain, command, args] of cases) {
  try {
    const result = await invoke(domain, command, args)
    const summary = JSON.stringify(result)
    console.log(`✓ ${domain}/${command} → ${summary.length > 220 ? `${summary.slice(0, 220)}…` : summary}`)
  } catch (error) {
    failed += 1
    console.error(`✗ ${domain}/${command} → ${error.message}`)
  }
}

// 跨域命令必须被拒绝
try {
  await invoke('edtApp', 'sandbox:delete', ['x'])
  failed += 1
  console.error('✗ 域校验未拦截跨域命令')
} catch (error) {
  console.log(`✓ 域校验拦截 → ${error.message}`)
}

child.stdin.write(`${JSON.stringify({ kind: 'shutdown' })}\n`)
await new Promise(resolve => child.once('exit', resolve))

if (failed > 0) {
  console.error(`\n✗ ${failed} 项失败`)
  process.exit(1)
}
console.log('\n✓ 桥接集成测试全部通过')
