import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { buildElectron } from './build-electron.mjs'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const rendererWaitTimeout = 15_000
// 监视根：electron / shared / backend 固定；工具后端按 tools/*/backend 动态发现，
// 与 build-electron.mjs 的入口扫描保持一致（新增工具不需要在两处登记，也不会漏掉热重编译）。
const toolBackendRoots = fs
  .readdirSync(path.join(rootDir, 'tools'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => path.join('tools', entry.name, 'backend'))
  .filter(relativeDir => fs.existsSync(path.join(rootDir, relativeDir)))
const watchRoots = ['electron', 'shared', 'backend', ...toolBackendRoots].map(dir => path.join(rootDir, dir))

let electronProcess = null
let stoppingElectron = false
let rebuildTimer = null
let rebuilding = false
let pendingRebuild = false
let lastSourceSignature = null
// 收集一次 debounce 窗口内触碰过的路径，仅用于「为什么没重建」的可观测性
const pendingEvents = new Set()

/**
 * 被监听目录的内容签名：只看 .ts 源码的内容。
 * 构建产物在 dist-electron/（不在监听范围内），但工具后端会在自己的目录里写运行期 JSON，
 * fs.watch 对这些写入同样会触发事件；只按事件重建会让 `pnpm dev` 在没改代码时反复重启。
 */
function collectSourceSignature() {
  const hash = createHash('sha1')
  const files = []

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        files.push(fullPath)
      }
    }
  }

  for (const root of watchRoots) {
    if (fs.existsSync(root)) walk(root)
  }

  files.sort()
  for (const file of files) {
    hash.update(path.relative(rootDir, file))
    hash.update('\0')
    try {
      hash.update(fs.readFileSync(file))
    } catch {
      hash.update('<unreadable>')
    }
    hash.update('\0')
  }

  return { digest: hash.digest('hex'), count: files.length }
}

/** 等 Vite 开发服务器就绪：超时返回 false，避免没开 vite 时无限等待 */
function waitForRenderer(timeoutMs = rendererWaitTimeout) {
  return new Promise((resolve) => {
    const urls = ['http://localhost:5173', 'http://127.0.0.1:5173']
    const deadline = Date.now() + timeoutMs

    const probe = (url, retry) => {
      const request = http.get(url, () => {
        request.destroy()
        resolve(true)
      })
      request.on('error', retry)
      request.setTimeout(1000, () => {
        request.destroy()
        retry()
      })
    }

    const check = () => {
      let index = 0

      const retry = () => {
        if (index < urls.length) {
          probe(urls[index++], retry)
          return
        }

        if (Date.now() >= deadline) {
          resolve(false)
          return
        }

        setTimeout(check, 300)
      }

      retry()
    }

    check()
  })
}

/**
 * 解析 electron 可执行文件绝对路径。
 * 不能直接 spawn('electron')：那要求 PATH 里有 node_modules/.bin（只在 pnpm/npm 脚本里成立），
 * 直接 `node scripts/dev-electron.mjs` 会报「'electron' 不是内部或外部命令」。
 * electron 包的默认导出就是二进制路径，且自带「二进制缺失则重新下载」的自愈逻辑。
 */
function resolveElectronBinary() {
  let binary

  try {
    binary = require('electron')
  } catch (error) {
    console.error('✗ 无法定位 electron 可执行文件：', error.message)
    console.error('  请先执行 pnpm install；若二进制下载失败，执行 pnpm rebuild electron 重试')
    process.exit(1)
  }

  if (typeof binary !== 'string' || !fs.existsSync(binary)) {
    console.error(`✗ electron 可执行文件不存在：${binary}`)
    console.error('  请执行 pnpm rebuild electron 重新下载二进制')
    process.exit(1)
  }

  return binary
}

/**
 * 预热渲染层依赖预构建后再拉窗口。
 *
 * Vite 的 HTTP 服务先就绪、依赖预构建（optimizeDeps）后完成：`/` 已经能响应，但 `/main.ts`
 * 里引用的 dep 文件还在写、`?v=` 哈希还会变。此时 Electron 立刻加载，拿到的就是
 * `504 (Outdated Optimize Dep)` → main.ts 模块图解不出来 → **窗口空白、无样式、无报错弹窗**。
 * 这里轮询 `/main.ts` 直到 `?v=` 哈希连续两次一致（预构建稳定），再启动 Electron。
 */
async function warmRendererDeps(timeoutMs = 20000) {
  const entry = 'http://localhost:5173/main.ts'
  const deadline = Date.now() + timeoutMs
  let lastHash = null

  while (Date.now() < deadline) {
    try {
      const response = await fetch(entry, { signal: AbortSignal.timeout(2000) })
      const body = await response.text()
      const hash = /v=([0-9a-f]+)/.exec(body)?.[1] ?? null
      if (hash && hash === lastHash) return true
      lastHash = hash
    } catch {
      // 服务还在起 / 被打断：下一轮再试
    }
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  return false
}

function startElectron() {
  const electronBinary = resolveElectronBinary()
  stoppingElectron = false
  const electronEnv = {
    ...process.env,
    NODE_ENV: 'development',
  }
  delete electronEnv.ELECTRON_RUN_AS_NODE

  // 用绝对路径且不开 shell：既不受 PATH 影响，也不会触发 DEP0190（shell:true 拼接参数）
  // EDT_NO_SANDBOX=1：安全软件（火绒 HIPS 等）阻止 Chromium 用受限令牌创建子进程时，
  // 表现为「GPU process launch failed / GPU process isn't usable」后立即退出，开发期可借此绕过。
  // 不在此传 --remote-debugging-port：调试端口由 electron/main.ts 按 NODE_ENV=development 统一开启。
  const electronArgs = ['.']
  if (process.env.EDT_NO_SANDBOX === '1') {
    electronArgs.push('--no-sandbox')
    console.warn('⚠ EDT_NO_SANDBOX=1：已关闭 Chromium 沙箱，仅用于被安全软件拦截时的本地开发')
  }

  electronProcess = spawn(electronBinary, electronArgs, {
    cwd: rootDir,
    env: electronEnv,
    stdio: 'inherit',
  })

  const startedAt = Date.now()
  electronProcess.on('error', (error) => {
    console.error(`✗ 启动 Electron 失败：${error.message}`)
    electronProcess = null
  })

  electronProcess.on('exit', (code, signal) => {
    electronProcess = null
    if (stoppingElectron) {
      stoppingElectron = false
      return
    }
    // 启动即挂掉（退出码非 0）时给一句能落地的提示，别只留一个静默的黑窗
    if (Date.now() - startedAt < 5000 && code !== 0) {
      console.warn(`⚠ Electron 启动后立即退出（code=${code} signal=${signal ?? '-'}）`)
      console.warn('  常见原因：electron 二进制未下完整（pnpm rebuild electron）、安全软件拦截 Chromium 子进程、或与已运行的开发态实例冲突')
      console.warn('  「与已运行实例冲突」只指同一形态（另一个 pnpm dev / pnpm start）：安装版用独立的 userData，不会再顶掉开发态')
      if (process.env.EDT_NO_SANDBOX !== '1') {
        console.warn('  若是被安全软件（如火绒 HIPS）拦截子进程创建，可临时用 EDT_NO_SANDBOX=1 pnpm dev 绕过，并给项目目录加白名单')
      }
    }
  })
}

function stopElectron() {
  if (!electronProcess?.pid) return Promise.resolve()

  const pid = electronProcess.pid
  stoppingElectron = true
  return new Promise((resolve) => {
    electronProcess.once('exit', resolve)
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' })
      return
    }
    electronProcess.kill('SIGTERM')
  })
}

async function rebuildAndRestart() {
  if (rebuilding) {
    pendingRebuild = true
    return
  }

  rebuilding = true
  try {
    await stopElectron()
    await buildElectron({ log: false })
    console.log('✓ Electron 已重建，正在重启')
    startElectron()
  } catch (error) {
    console.error(error)
  } finally {
    rebuilding = false
    if (pendingRebuild) {
      pendingRebuild = false
      await rebuildAndRestart()
    }
  }
}

function scheduleRebuild(label) {
  if (label) pendingEvents.add(label)
  clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(() => {
    const events = [...pendingEvents]
    pendingEvents.clear()

    const { digest } = collectSourceSignature()
    if (digest === lastSourceSignature) {
      if (events.length > 0) {
        const shown = events.slice(0, 3).join(', ')
        const rest = events.length > 3 ? ` 等 ${events.length} 项` : ''
        console.log(`· 忽略空事件（不是 .ts 源码变更）：${shown}${rest}`)
      }
      return
    }

    lastSourceSignature = digest
    void rebuildAndRestart()
  }, 150)
}

function watchDirectory(dir) {
  const watchers = []
  if (!fs.existsSync(dir)) return watchers

  watchers.push(fs.watch(dir, (_eventType, filename) => {
    const relative = path.relative(rootDir, path.join(dir, filename ? filename.toString() : ''))
    scheduleRebuild(filename ? relative : path.relative(rootDir, dir))
  }))
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    if (entry.isDirectory()) {
      watchers.push(...watchDirectory(path.join(dir, entry.name)))
    }
  }

  return watchers
}

await buildElectron({ log: false })
lastSourceSignature = collectSourceSignature().digest

const rendererReady = await waitForRenderer()
if (!rendererReady) {
  console.warn(`⚠ ${Math.round(rendererWaitTimeout / 1000)}s 内未等到 Vite 开发服务器（http://localhost:5173）`)
  console.warn('  窗口会加载失败：请在另一个终端执行 pnpm web，或直接用 pnpm dev 同时启动两者')
} else if (!(await warmRendererDeps())) {
  console.warn('⚠ Vite 依赖预构建 20s 内未稳定，窗口可能是空白（控制台 504 Outdated Optimize Dep）')
  console.warn('  处理：停掉 dev，删掉 node_modules/.vite 后重跑 pnpm dev（只删缓存，可重新生成）')
}

startElectron()

const watchers = watchRoots.flatMap(watchDirectory)

async function shutdown() {
  for (const watcher of watchers) {
    watcher.close()
  }
  await stopElectron()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
