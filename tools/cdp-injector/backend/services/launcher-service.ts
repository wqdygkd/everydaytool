import type { ChildProcess } from 'node:child_process'
import { exec, spawn } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { resolveExecutablePath } from '../utils/resolve-executable.js'

const execAsync = promisify(exec)

const DEBUG_PORT_RE = /--remote-debugging-port(?:=|\s+)\d+/i

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

async function killProcessTree(pid: number): Promise<void> {
  if (!pid) return
  if (process.platform === 'win32') {
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
    // ignore
  }
}

interface LaunchedProcess {
  pid: number
  child: ChildProcess
}

export class ProcessLauncher {
  private processes = new Map<string, LaunchedProcess>()

  async launch(
    profileId: string,
    executable: string,
    argsString: string,
    debugPort: number,
  ): Promise<{ pid: number, args: string[] }> {
    if (this.processes.has(profileId)) {
      throw new Error('该配置已在运行中')
    }

    const resolvedExecutable = await resolveExecutablePath(executable)
    const args = ensureDebugPort(parseArgs(argsString), debugPort)
    const child = spawn(resolvedExecutable, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    })

    if (!child.pid) {
      throw new Error('进程启动失败')
    }

    this.processes.set(profileId, { pid: child.pid, child })

    child.on('exit', () => {
      this.processes.delete(profileId)
    })

    return { pid: child.pid, args }
  }

  async stop(profileId: string): Promise<boolean> {
    const entry = this.processes.get(profileId)
    if (!entry) return false
    await killProcessTree(entry.pid)
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
