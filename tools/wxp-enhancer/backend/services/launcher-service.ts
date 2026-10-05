import type { ChildProcess } from 'node:child_process'
import { exec, spawn } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { sleep } from '../../../../shared/sleep.js'
import { resolveExecutablePath } from '../utils/resolve-executable.js'

const execAsync = promisify(exec)

const DEBUG_PORT_RE = /--remote-debugging-port(?:=|\s+)\d+/i
// Chromium 111+ 默认拒绝带 Origin 的调试 WebSocket（前端页会被 403，报 connection was closed）
const ALLOW_ORIGINS_RE = /--remote-allow-origins(?:=|\s+)\S+/i

function parseArgs(argsString = ''): string[] {
  const input = argsString.trim()
  if (!input) return []
  const tokens: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (const match of input.matchAll(re)) {
    tokens.push(match[1] ?? match[2] ?? match[3])
  }
  return tokens
}

function ensureDebugPort(args: string[], port: number): string[] {
  const hasPort = args.some(arg => DEBUG_PORT_RE.test(arg))
  if (hasPort) return args
  return [...args, `--remote-debugging-port=${port}`]
}

function ensureAllowOrigins(args: string[], port: number): string[] {
  const has = args.some(arg => ALLOW_ORIGINS_RE.test(arg))
  if (has) return args
  // 精确放行调试前端自身的同源 Origin，不放开 *
  return [...args, `--remote-allow-origins=http://127.0.0.1:${port}`]
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true
    await sleep(250)
  }
  return !isProcessAlive(pid)
}

interface KillOptions {
  /** 先尝试正常关闭（通知应用自行退出，让其保存会话/登录状态），超时后再强杀 */
  graceful?: boolean
  /** 优雅关闭的等待时长，默认 4s */
  timeoutMs?: number
}

async function killProcessTree(pid: number, options: KillOptions = {}): Promise<void> {
  if (!pid) return
  const { graceful = false, timeoutMs = 4000 } = options
  if (process.platform === 'win32') {
    if (graceful) {
      // taskkill 不带 /F 时向进程树窗口投递 WM_CLOSE，给应用留出落盘会话的机会
      try {
        await execAsync(`taskkill /PID ${pid} /T`)
      } catch {
        // 进程可能已退出
      }
      if (await waitForExit(pid, timeoutMs)) return
    }
    try {
      await execAsync(`taskkill /PID ${pid} /T /F`)
    } catch {
      // process may already exit
    }
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  if (graceful && await waitForExit(pid, timeoutMs)) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // ignore
  }
}

interface LaunchedProcess {
  pid: number
  child: ChildProcess
}

interface LaunchOptions {
  /** 被拉起的进程退出时回调（含用户自行关闭应用的情况） */
  onExit?: (code: number | null) => void
}

export class ProcessLauncher {
  private processes = new Map<string, LaunchedProcess>()

  async launch(
    profileId: string,
    executable: string,
    argsString: string,
    debugPort: number,
    options: LaunchOptions = {},
  ): Promise<{ pid: number, args: string[] }> {
    if (this.processes.has(profileId)) {
      throw new Error('该配置已在运行中')
    }

    const resolvedExecutable = await resolveExecutablePath(executable)
    const args = ensureAllowOrigins(ensureDebugPort(parseArgs(argsString), debugPort), debugPort)
    const child = spawn(resolvedExecutable, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    })

    if (!child.pid) {
      throw new Error('进程启动失败')
    }

    this.processes.set(profileId, { pid: child.pid, child })

    child.on('exit', (code) => {
      this.processes.delete(profileId)
      options.onExit?.(code)
    })

    return { pid: child.pid, args }
  }

  async stop(profileId: string, options: KillOptions = {}): Promise<boolean> {
    const entry = this.processes.get(profileId)
    if (!entry) return false
    await killProcessTree(entry.pid, options)
    this.processes.delete(profileId)
    return true
  }

  async stopAll(): Promise<void> {
    const ids = [...this.processes.keys()]
    await Promise.all(ids.map(id => this.stop(id)))
  }

  isRunning(profileId: string): boolean {
    return this.processes.has(profileId)
  }

  getPid(profileId: string): number | null {
    return this.processes.get(profileId)?.pid ?? null
  }
}

export const processLauncher = new ProcessLauncher()
