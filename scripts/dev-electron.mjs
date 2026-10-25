import { spawn } from 'node:child_process'
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
const watchRoots = [
  'electron',
  'shared',
  'backend',
  'tools/chrome-sandbox/backend',
  'tools/env-browser/backend',
  'tools/treease-editor/backend',
  'tools/wxp-enhancer/backend',
].map(dir => path.join(rootDir, dir))

let electronProcess = null
let stoppingElectron = false
let rebuildTimer = null
let rebuilding = false
let pendingRebuild = false

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
  // 表现为「GPU process launch failed / GPU process isn't usable」后立即退出，开发期可借此绕过
  const electronArgs = ['.', '--remote-debugging-port=0']
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
      console.warn('  常见原因：electron 二进制未下完整（pnpm rebuild electron）、安全软件拦截 Chromium 子进程、或与已运行实例冲突')
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

function scheduleRebuild() {
  clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(rebuildAndRestart, 150)
}

function watchDirectory(dir) {
  const watchers = []
  if (!fs.existsSync(dir)) return watchers

  watchers.push(fs.watch(dir, scheduleRebuild))
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    if (entry.isDirectory()) {
      watchers.push(...watchDirectory(path.join(dir, entry.name)))
    }
  }

  return watchers
}

await buildElectron({ log: false })

const rendererReady = await waitForRenderer()
if (!rendererReady) {
  console.warn(`⚠ ${Math.round(rendererWaitTimeout / 1000)}s 内未等到 Vite 开发服务器（http://localhost:5173）`)
  console.warn('  窗口会加载失败：请在另一个终端执行 pnpm web，或直接用 pnpm dev 同时启动两者')
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
