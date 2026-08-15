import type {
  Fingerprint,
  FingerprintUpdatePayload,
  Sandbox,
  SandboxCreatePayload,
  SandboxUpdatePayload,
} from '../../../../shared/types.js'
import { randomUUID } from 'node:crypto'
import { setupSandboxDeveloperMode, shouldSkipDeveloperModeSetup } from '../chrome/developer-mode.js'
import { launchChrome } from '../chrome/launcher.js'
import { findRunningPid, isRunning, killProcess, onProcessExit, queryChromeSandboxProcesses } from '../chrome/process-manager.js'
import { focusChromeWindow } from '../chrome/window-controller.js'
import { SANDBOX_COLORS } from '../constants/sandbox.js'
import { prepareFingerprintExtension, updateFingerprintConfig } from '../fingerprint/config-writer.js'
import { generateRandomFingerprint } from '../fingerprint/generator.js'
import { IPC_CHANNELS } from '../ipc/channels.js'
import { initSandboxUserData, repairSandboxProfile } from '../profile/cloner.js'
import { fingerprintStore } from '../store/fingerprint-store.js'
import { sandboxStore } from '../store/sandbox-store.js'
import { ensureDir, removeIfExists } from '../utils/file-ops.js'
import { logger } from '../utils/logger.js'
import {
  getDefaultChromeProfilePath,
  getSandboxFingerprintExtPath,
  getSandboxPath,
  getSandboxProfileDirectoryName,
} from '../utils/path-helper.js'

let statusEmitter: ((channel: string, payload: unknown) => void) | null = null

export function setStatusEmitter(emitter: (channel: string, payload: unknown) => void): void {
  statusEmitter = emitter
  onProcessExit((sandboxId) => {
    emit(IPC_CHANNELS.EVENT_PROCESS_EXITED, { sandboxId })
    sandboxStore.update(sandboxId, { status: 'stopped', chromePid: null })
  })
}

function emit(channel: string, payload: unknown): void {
  if (statusEmitter) statusEmitter(channel, payload)
}

function syncRunningState(sandbox: Sandbox): Sandbox | null {
  const running = isRunning(sandbox.id, sandbox.userDataPath, {
    allowProcessQuery: sandbox.status === 'running',
  })
  const shouldUpdate = running !== (sandbox.status === 'running')
  if (!shouldUpdate) return sandbox

  const newStatus = running ? 'running' : 'stopped'
  if (!running) emit(IPC_CHANNELS.EVENT_PROCESS_EXITED, { sandboxId: sandbox.id })
  return sandboxStore.update(sandbox.id, {
    status: newStatus,
    chromePid: running ? sandbox.chromePid : null,
  })
}

async function refreshSandboxPid(sandboxId: string): Promise<Sandbox | null> {
  const sandbox = sandboxStore.getById(sandboxId)
  if (!sandbox) return null

  const { pids } = await queryChromeSandboxProcesses(sandbox.userDataPath)
  const pid = pids[0] || sandbox.chromePid
  if (!pid || pid === sandbox.chromePid) return sandbox

  return sandboxStore.update(sandboxId, { chromePid: pid })
}

async function focusRunningSandbox(sandbox: Sandbox): Promise<Sandbox | null> {
  const pid = findRunningPid(sandbox.id, sandbox.userDataPath) || sandbox.chromePid
  if (!pid) return null
  await focusChromeWindow(pid)
  return sandboxStore.update(sandbox.id, {
    status: 'running',
    chromePid: pid,
    lastActiveAt: new Date().toISOString(),
  })
}

export const sandboxService = {
  async getAll(): Promise<Sandbox[]> {
    return sandboxStore.getAll().map(syncRunningState).filter((s): s is Sandbox => s !== null)
  },

  async getById(id: string): Promise<Sandbox | null> {
    const sandbox = sandboxStore.getById(id)
    return sandbox ? syncRunningState(sandbox) : null
  },

  async create(data: SandboxCreatePayload): Promise<Sandbox | null> {
    const { name, fingerprintData = null, inheritExtensions = false, launchOptions = {} } = data
    const sandboxId = `sandbox_${randomUUID().replace(/-/g, '').slice(0, 8)}`
    const sandboxPath = getSandboxPath(sandboxId)
    const fingerprintExtPath = getSandboxFingerprintExtPath(sandboxId)

    await ensureDir(sandboxPath)
    await initSandboxUserData(sandboxPath, getDefaultChromeProfilePath(), { inheritExtensions })

    const fingerprint = fingerprintData || generateRandomFingerprint()
    fingerprintStore.create(fingerprint)
    await prepareFingerprintExtension(fingerprintExtPath, fingerprint)

    const sandbox = sandboxStore.create({
      id: sandboxId,
      name,
      category: 'other',
      color: SANDBOX_COLORS.sandbox,
      userDataPath: sandboxPath,
      fingerprintId: fingerprint.id,
      metadata: {
        inheritExtensions: Boolean(inheritExtensions),
        launchOptions: {
          disableSafetyChecks: Boolean(launchOptions.disableSafetyChecks),
          disableCors: Boolean(launchOptions.disableCors),
          customArgs: launchOptions.customArgs || '',
        },
      },
    })

    logger.info('Sandbox created', { sandboxId, name, inheritExtensions, launchOptions })
    return sandbox
  },

  async activate(sandboxId: string): Promise<Sandbox | null> {
    let sandbox = await this.getById(sandboxId)
    if (!sandbox) throw new Error('沙箱不存在')

    if (sandbox.status === 'running' && isRunning(sandboxId, sandbox.userDataPath)) {
      return focusRunningSandbox(sandbox)
    }

    const inheritExtensions = Boolean(sandbox.metadata?.inheritExtensions)
    await repairSandboxProfile(sandbox.userDataPath, undefined, { inheritExtensions })

    const focused = await focusRunningSandbox(sandbox)
    if (focused) return focused

    const windowPosition = { x: 100, y: 100 }
    const windowSize = { width: 1280, height: 800 }

    let metadata = sandbox.metadata
    if (!metadata?.developerModeEnabled && await shouldSkipDeveloperModeSetup(sandbox)) {
      metadata = { ...(metadata || {}), developerModeEnabled: true }
    }

    const { pid, debugPort } = await launchChrome({
      sandboxId,
      userDataDir: sandbox.userDataPath,
      profileDirectory: getSandboxProfileDirectoryName(sandboxId),
      extensionPath: getSandboxFingerprintExtPath(sandboxId),
      enableDeveloperMode: !metadata?.developerModeEnabled,
      windowPosition,
      windowSize,
      launchOptions: metadata?.launchOptions || {},
    })

    if (debugPort && await setupSandboxDeveloperMode(debugPort, {
      x: windowPosition.x,
      y: windowPosition.y,
      width: windowSize.width,
      height: windowSize.height,
    })) {
      metadata = { ...(metadata || {}), developerModeEnabled: true }
    }

    sandbox = sandboxStore.update(sandboxId, {
      status: 'running',
      chromePid: pid,
      lastUsedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      ...(metadata !== sandbox.metadata ? { metadata } : {}),
    })

    emit(IPC_CHANNELS.EVENT_STATUS_CHANGED, { sandboxId, status: 'running' })
    return (await refreshSandboxPid(sandboxId)) || sandbox
  },

  async close(sandboxId: string): Promise<Sandbox | null> {
    const sandbox = await this.getById(sandboxId)
    if (!sandbox) throw new Error('沙箱不存在')

    await killProcess(sandboxId, sandbox.userDataPath)
    const updated = sandboxStore.update(sandboxId, {
      status: 'stopped',
      chromePid: null,
    })

    emit(IPC_CHANNELS.EVENT_STATUS_CHANGED, { sandboxId, status: 'stopped' })
    return updated
  },

  async delete(sandboxId: string): Promise<boolean> {
    const sandbox = await this.getById(sandboxId)
    if (!sandbox) throw new Error('沙箱不存在')

    if (sandbox.status === 'running') {
      await this.close(sandboxId)
    }

    await removeIfExists(sandbox.userDataPath)
    fingerprintStore.delete(sandbox.fingerprintId)
    sandboxStore.delete(sandboxId)
    logger.info('Sandbox deleted', { sandboxId })
    return true
  },

  update(sandboxId: string, data: SandboxUpdatePayload): Sandbox | null {
    return sandboxStore.update(sandboxId, data)
  },

  async refreshStatus(sandboxId: string): Promise<Sandbox | null> {
    if (!sandboxStore.getById(sandboxId)) throw new Error('沙箱不存在')
    return refreshSandboxPid(sandboxId)
  },
}

export async function updateSandboxFingerprint(
  sandboxId: string,
  fingerprintData: FingerprintUpdatePayload,
): Promise<Fingerprint | null> {
  const sandbox = sandboxStore.getById(sandboxId)
  if (!sandbox) throw new Error('沙箱不存在')
  if (!sandbox.fingerprintId) throw new Error('沙箱未关联指纹')

  fingerprintStore.update(sandbox.fingerprintId, fingerprintData)
  await updateFingerprintConfig(getSandboxFingerprintExtPath(sandboxId), fingerprintData as Fingerprint)
  return fingerprintStore.getById(sandbox.fingerprintId)
}
