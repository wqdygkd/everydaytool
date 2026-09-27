import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { buildElectron } from './build-electron.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const watchRoots = [
  'electron',
  'shared',
  'tools/chrome-sandbox/backend',
  'tools/env-browser/backend',
  'tools/treease-editor/backend',
  'tools/cdp-injector/backend',
].map(dir => path.join(rootDir, dir))

let electronProcess = null
let rebuildTimer = null
let rebuilding = false
let pendingRebuild = false

function waitForRenderer() {
  return new Promise((resolve) => {
    const urls = ['http://localhost:5173', 'http://127.0.0.1:5173']

    const probe = (url, retry) => {
      const request = http.get(url, () => {
        request.destroy()
        resolve()
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

        setTimeout(check, 300)
      }

      retry()
    }

    check()
  })
}

function startElectron() {
  const electronEnv = {
    ...process.env,
    NODE_ENV: 'development',
  }
  delete electronEnv.ELECTRON_RUN_AS_NODE

  electronProcess = spawn('electron', ['.', '--remote-debugging-port=0'], {
    cwd: rootDir,
    env: electronEnv,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })

  electronProcess.on('exit', () => {
    electronProcess = null
  })
}

function stopElectron() {
  if (!electronProcess?.pid) return Promise.resolve()

  const pid = electronProcess.pid
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
await waitForRenderer()
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
