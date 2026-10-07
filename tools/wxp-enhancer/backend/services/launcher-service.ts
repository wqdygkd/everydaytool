import { execFile, spawn } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { sleep } from '../../../../shared/sleep.ts'
import { resolveExecutablePath } from '../utils/resolve-executable.ts'

const execFileAsync = promisify(execFile)

const KILL_TIMEOUT_MS = 6000

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
        await execFileAsync('taskkill', ['/PID', String(pid), '/T'], { timeout: KILL_TIMEOUT_MS, windowsHide: true })
      } catch {
        // 进程可能已退出
      }
      if (await waitForExit(pid, timeoutMs)) return
    }
    try {
      await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: KILL_TIMEOUT_MS, windowsHide: true })
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

interface LaunchOptions {
  /** 被拉起的进程退出时回调（含用户自行关闭应用的情况） */
  onExit?: (code: number | null) => void
}

export class ProcessLauncher {
  /** profileId -> 已拉起进程的 PID */
  private processes = new Map<string, number>()

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
      stdio: 'ignore',
      windowsHide: true,
    })

    if (!child.pid) {
      throw new Error('进程启动失败')
    }

    this.processes.set(profileId, child.pid)

    child.on('exit', (code) => {
      this.processes.delete(profileId)
      options.onExit?.(code)
    })

    return { pid: child.pid, args }
  }

  async stop(profileId: string, options: KillOptions = {}): Promise<boolean> {
    const pid = this.processes.get(profileId)
    if (pid === undefined) return false
    await killProcessTree(pid, options)
    this.processes.delete(profileId)
    return true
  }

  isRunning(profileId: string): boolean {
    return this.processes.has(profileId)
  }
}

export const processLauncher = new ProcessLauncher()
