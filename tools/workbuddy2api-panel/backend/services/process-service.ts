import type { ChildProcess } from 'node:child_process'
import { execFile, spawn } from 'node:child_process'
import { access, chmod } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { logger } from '../../../../backend/utils/logger.ts'
import { getWb2apiCurrentDir, getWb2apiRunDir } from '../utils/paths.ts'
import { wb2apiBinaryFileName } from '../utils/platform.ts'
import { enforceStartConfig } from './config-service.ts'
import { probeHealthz } from './health-service.ts'

const execFileAsync = promisify(execFile)
const STOP_GRACE_MS = 8_000
const READY_TIMEOUT_MS = 20_000
const READY_POLL_MS = 400

let child: ChildProcess | null = null
let lastStderr = ''
let managedPid: number | null = null

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export function getManagedPid(): number | null {
  if (child?.pid && !child.killed && child.exitCode == null) return child.pid
  return managedPid
}

export function isProcessManagedAlive(): boolean {
  const pid = getManagedPid()
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function peekLastStderr(): string {
  return lastStderr.trim()
}

export function clearLastStderr(): void {
  lastStderr = ''
}

export async function resolveCurrentBinaryPath(): Promise<string | null> {
  const name = wb2apiBinaryFileName()
  const direct = path.join(getWb2apiCurrentDir(), name)
  if (await pathExists(direct)) return direct
  // 解压可能多一层目录
  const { readdir } = await import('node:fs/promises')
  try {
    const entries = await readdir(getWb2apiCurrentDir(), { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const nested = path.join(getWb2apiCurrentDir(), e.name, name)
      if (await pathExists(nested)) return nested
    }
  } catch {
    // ignore
  }
  return null
}

/** macOS 去掉 quarantine，避免 Gatekeeper 拦启动 */
export async function clearMacQuarantine(binaryPath: string): Promise<void> {
  if (process.platform !== 'darwin') return
  try {
    await execFileAsync('xattr', ['-dr', 'com.apple.quarantine', binaryPath])
  } catch {
    try {
      await execFileAsync('xattr', ['-d', 'com.apple.quarantine', binaryPath])
    } catch {
      // 无 quarantine 属性时忽略
    }
  }
}

export async function prepareBinaryPermissions(binaryPath: string): Promise<void> {
  if (process.platform !== 'win32') {
    await chmod(binaryPath, 0o755).catch(() => {})
  }
  await clearMacQuarantine(binaryPath)
  // 也对 current 目录清一次（zip 解压可能带 xattr）
  if (process.platform === 'darwin') {
    await clearMacQuarantine(getWb2apiCurrentDir()).catch(() => {})
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function killPid(pid: number, force: boolean): Promise<void> {
  if (process.platform === 'win32') {
    const args = force
      ? ['/pid', String(pid), '/T', '/F']
      : ['/pid', String(pid), '/T']
    await new Promise<void>((resolve) => {
      const p = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true })
      p.on('exit', () => resolve())
      p.on('error', () => resolve())
    })
    return
  }
  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch {
    // ignore
  }
}

async function waitExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (proc.exitCode != null || proc.killed) return true
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (v: boolean) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(v)
    }
    timer = setTimeout(finish, timeoutMs, false)
    proc.once('exit', () => finish(true))
  })
}

/** STOP：SIGTERM/taskkill → 超时强杀；主动停止不把关停日志当成错误 */
export async function stopManagedProcess(): Promise<void> {
  const proc = child
  const pid = proc?.pid ?? managedPid
  child = null
  managedPid = null
  if (!pid) {
    clearLastStderr()
    return
  }

  try {
    if (proc && proc.exitCode == null) {
      await killPid(pid, false)
      const exited = await waitExit(proc, STOP_GRACE_MS)
      if (!exited && isPidAlive(pid)) await killPid(pid, true)
      await waitExit(proc, 2000)
    } else if (isPidAlive(pid)) {
      await killPid(pid, false)
      await new Promise(r => setTimeout(r, 800))
      if (isPidAlive(pid)) await killPid(pid, true)
    }
  } finally {
    clearLastStderr()
  }
}

/**
 * START：强制 listen=127.0.0.1、关自更新后 spawn。
 * 默认不自动调用；单实例。
 */
export async function startManagedProcess(): Promise<{ port: number, pid: number }> {
  if (isProcessManagedAlive()) {
    throw new Error('服务已在运行')
  }

  const binary = await resolveCurrentBinaryPath()
  if (!binary) throw new Error('未找到 wb2api 二进制，请先安装')

  await prepareBinaryPermissions(binary)
  const { port, configPath } = await enforceStartConfig()
  const runDir = getWb2apiRunDir()

  lastStderr = ''
  const spawned = spawn(binary, ['-config', configPath], {
    cwd: runDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env },
  })

  child = spawned
  managedPid = spawned.pid ?? null

  spawned.stderr?.on('data', (chunk: string | Uint8Array) => {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
    lastStderr = `${lastStderr}${text}`.slice(-8000)
  })
  spawned.stdout?.on('data', () => {
    // 无日志面板：stdout 丢弃
  })
  spawned.on('error', (error) => {
    logger.warn('wb2api spawn error', { error: error.message })
    lastStderr = `${lastStderr}\n${error.message}`.slice(-8000)
  })
  spawned.on('exit', (code, signal) => {
    if (child === spawned) {
      child = null
      managedPid = null
    }
    if (code && code !== 0) {
      logger.warn('wb2api exited', { code, signal })
    }
  })

  if (!spawned.pid) {
    child = null
    throw new Error(`启动失败${lastStderr ? `：${lastStderr.trim()}` : ''}`)
  }

  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (spawned.exitCode != null) {
      const err = peekLastStderr() || `进程提前退出 code=${spawned.exitCode}`
      throw new Error(err)
    }
    const health = await probeHealthz(port)
    if (health.ok) {
      return { port, pid: spawned.pid }
    }
    await new Promise(r => setTimeout(r, READY_POLL_MS))
  }

  // 超时仍未探活成功：停掉，避免残留
  await stopManagedProcess()
  throw new Error(peekLastStderr() || `启动超时：${READY_TIMEOUT_MS}ms 内 /healthz 未命中 service=workbuddy2api`)
}

/** 查找占用端口、且非本工具托管的残留进程 */
export async function findOrphanPids(port: number): Promise<number[]> {
  const managed = getManagedPid()
  const pids = new Set<number>()

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true })
      const needle = `127.0.0.1:${port}`
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.includes(needle) || !line.includes('LISTENING')) continue
        const parts = line.trim().split(/\s+/)
        const pid = Number(parts[parts.length - 1])
        if (Number.isInteger(pid) && pid > 0) pids.add(pid)
      }
    } else {
      try {
        const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
        for (const line of stdout.split(/\n/)) {
          const pid = Number(line.trim())
          if (Number.isInteger(pid) && pid > 0) pids.add(pid)
        }
      } catch {
        // lsof 无结果会非 0 退出
      }
    }
  } catch (error) {
    logger.warn('orphan port scan failed', { error: (error as Error).message })
  }

  if (managed) pids.delete(managed)
  return [...pids]
}

/** 只结束占用，不接管 */
export async function killOrphanProcesses(port: number): Promise<number[]> {
  const pids = await findOrphanPids(port)
  for (const pid of pids) {
    await killPid(pid, true)
  }
  return pids
}
