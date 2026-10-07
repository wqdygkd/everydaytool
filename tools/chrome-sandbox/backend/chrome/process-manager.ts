import type { ChildProcess } from 'node:child_process'
import { execFile, execFileSync, execSync, spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { logger } from '../../../../backend/utils/logger.ts'

const execFileAsync = promisify(execFile)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WINDOWS_QUERY_SCRIPT = path.join(__dirname, 'chrome-process-query.ps1')
const EMPTY_SNAPSHOT = Object.freeze({ pids: [] })
const QUERY_CACHE_MS = 8000

interface ProcessSnapshot {
  pids: number[]
}

const processes = new Map<string, ChildProcess>()
const userDataDirs = new Map<string, string>()
const queryCache = new Map<string, { result: ProcessSnapshot, at: number }>()
const inFlightQueries = new Map<string, Promise<ProcessSnapshot>>()
let exitHandler: ((sandboxId: string) => void) | null = null

const GRACEFUL_TIMEOUT_MS = 10000
function POWERSHELL_QUERY_ARGS(userDataDir: string): string[] {
  return [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    WINDOWS_QUERY_SCRIPT,
    '-UserDataDir',
    userDataDir,
  ]
}

function logWindowsQueryFailure(userDataDir: string, error: unknown): void {
  logger.warn('Failed to query Chrome process tree on Windows', { userDataDir, error: (error as Error).message })
}

function queryWindowsChromeSync(userDataDir: string): ProcessSnapshot {
  const output = execFileSync(
    'powershell.exe',
    POWERSHELL_QUERY_ARGS(userDataDir),
    { encoding: 'utf8', timeout: 15000, windowsHide: true },
  ).trim()
  const result = parseQueryOutput(output)
  setCachedSnapshot(userDataDir, result)
  return result
}

export function onProcessExit(handler: (sandboxId: string) => void): void {
  exitHandler = handler
}

function invalidateChromeProcessCache(userDataDir?: string): void {
  if (userDataDir) {
    queryCache.delete(userDataDir)
  }
}

function parseQueryOutput(output: string): ProcessSnapshot {
  if (!output) return { ...EMPTY_SNAPSHOT }

  const parsed = JSON.parse(output) as { pids?: unknown }
  const pids = Array.isArray(parsed.pids) ? parsed.pids : [parsed.pids].filter(Boolean)
  return {
    pids: pids.map(pid => Number(pid)).filter(Number.isFinite),
  }
}

function getCachedSnapshot(userDataDir: string): ProcessSnapshot | null {
  const entry = queryCache.get(userDataDir)
  if (entry && Date.now() - entry.at < QUERY_CACHE_MS) {
    return entry.result
  }
  return null
}

function setCachedSnapshot(userDataDir: string, result: ProcessSnapshot): void {
  queryCache.set(userDataDir, { result, at: Date.now() })
}

function findUnixPidsByUserDataDir(userDataDir: string): number[] {
  try {
    const output = execSync(`pgrep -f "${userDataDir}"`, { encoding: 'utf8' }).trim()
    if (!output) return []
    return output.split(/\s+/).map(pid => parseInt(pid, 10)).filter(Number.isFinite)
  } catch {
    return []
  }
}

async function runWindowsChromeQuery(userDataDir: string): Promise<ProcessSnapshot> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      POWERSHELL_QUERY_ARGS(userDataDir),
      { encoding: 'utf8', timeout: 15000, windowsHide: true },
    )
    const result = parseQueryOutput(stdout.trim())
    setCachedSnapshot(userDataDir, result)
    return result
  } catch (error) {
    logWindowsQueryFailure(userDataDir, error)
    return { ...EMPTY_SNAPSHOT }
  }
}

export async function queryChromeSandboxProcesses(userDataDir: string): Promise<ProcessSnapshot> {
  if (!userDataDir) return { ...EMPTY_SNAPSHOT }

  if (process.platform !== 'win32') {
    return { pids: findUnixPidsByUserDataDir(userDataDir) }
  }

  const cached = getCachedSnapshot(userDataDir)
  if (cached) return cached

  const pending = inFlightQueries.get(userDataDir)
  if (pending) return pending

  const query = runWindowsChromeQuery(userDataDir).finally(() => {
    inFlightQueries.delete(userDataDir)
  })

  inFlightQueries.set(userDataDir, query)
  return query
}

function getChromeSandboxSnapshotSync(userDataDir: string): ProcessSnapshot {
  if (!userDataDir) return { ...EMPTY_SNAPSHOT }

  if (process.platform !== 'win32') {
    return { pids: findUnixPidsByUserDataDir(userDataDir) }
  }

  const cached = getCachedSnapshot(userDataDir)
  if (cached) return cached

  try {
    return queryWindowsChromeSync(userDataDir)
  } catch (error) {
    logWindowsQueryFailure(userDataDir, error)
    return { ...EMPTY_SNAPSHOT }
  }
}

export function registerProcess(sandboxId: string, childProcess: ChildProcess, userDataDir: string): void {
  processes.set(sandboxId, childProcess)
  if (userDataDir) userDataDirs.set(sandboxId, userDataDir)

  childProcess.on('exit', (code, signal) => {
    logger.info('Chrome process exited', { sandboxId, code, signal })
    processes.delete(sandboxId)

    const dir = userDataDirs.get(sandboxId)
    if (dir && getChromeSandboxSnapshotSync(dir).pids.length > 0) {
      logger.info('Chrome still running for sandbox', { sandboxId })
      return
    }

    userDataDirs.delete(sandboxId)
    if (exitHandler) exitHandler(sandboxId)
  })
}

function findPidsByUserDataDir(userDataDir: string): number[] {
  return getChromeSandboxSnapshotSync(userDataDir).pids
}

export function isRunning(
  sandboxId: string,
  userDataDir?: string | null,
  { allowProcessQuery = true }: { allowProcessQuery?: boolean } = {},
): boolean {
  const proc = processes.get(sandboxId)
  if (proc != null && proc.exitCode == null && !proc.killed) {
    return true
  }

  if (!allowProcessQuery) {
    return false
  }

  const dir = userDataDir || userDataDirs.get(sandboxId)
  if (dir && findPidsByUserDataDir(dir).length > 0) {
    return true
  }

  return false
}

export function findRunningPid(sandboxId: string, userDataDir?: string | null): number | null {
  const proc = processes.get(sandboxId)
  if (proc?.pid && isPidAlive(proc.pid)) {
    return proc.pid
  }
  const pids = findPidsByUserDataDir(userDataDir || '')
  return pids[0] || null
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function waitForProcessExit(childProcess: ChildProcess | null, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!childProcess || childProcess.exitCode != null || childProcess.killed) {
      resolve(true)
      return
    }

    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    timer = setTimeout(finish, timeoutMs, false)
    childProcess.once('exit', () => finish(true))
  })
}

async function killPidTree(pid: number, force = false): Promise<void> {
  if (process.platform === 'win32') {
    const args = force
      ? ['/pid', String(pid), '/T', '/F']
      : ['/pid', String(pid), '/T']
    spawn('taskkill', args, { stdio: 'ignore' })
    return
  }

  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch {
    // ignore
  }
}

export async function killProcess(sandboxId: string, userDataDir?: string | null): Promise<boolean> {
  const proc = processes.get(sandboxId)
  const trackedDir = userDataDir || userDataDirs.get(sandboxId)
  const pids = new Set<number>([
    ...(proc?.pid ? [proc.pid] : []),
    ...findPidsByUserDataDir(trackedDir || ''),
  ])

  if (pids.size === 0) {
    processes.delete(sandboxId)
    userDataDirs.delete(sandboxId)
    return false
  }

  try {
    for (const pid of pids) {
      await killPidTree(pid, false)
    }

    const deadline = Date.now() + GRACEFUL_TIMEOUT_MS
    while (Date.now() < deadline) {
      const alive = [...pids].some(pid => isPidAlive(pid))
      if (!alive) break
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    for (const pid of pids) {
      if (isPidAlive(pid)) {
        logger.warn('Graceful Chrome shutdown timed out, forcing kill', { sandboxId, pid })
        await killPidTree(pid, true)
      }
    }

    if (proc) {
      await waitForProcessExit(proc, 3000)
    }

    processes.delete(sandboxId)
    userDataDirs.delete(sandboxId)
    invalidateChromeProcessCache(trackedDir)
    return true
  } catch (error) {
    logger.error('Failed to kill Chrome process', { sandboxId, error: (error as Error).message })
    return false
  }
}
