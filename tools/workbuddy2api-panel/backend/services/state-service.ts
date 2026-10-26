import type { Wb2apiPanelState, Wb2apiProgressEvent } from '../../../../shared/workbuddy2api-panel.ts'
import { access } from 'node:fs/promises'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import {
  buildWb2apiPanelUrl,
  defaultWb2apiPanelState,
} from '../../../../shared/workbuddy2api-panel.ts'
import { WB2API_PANEL_IPC_CHANNELS } from '../ipc/channels.ts'
import { readManifest } from '../store/manifest-store.ts'
import { readAppSettings } from '../store/settings-store.ts'
import { isInstallBusy } from './busy-flag.ts'
import { readConfigJson, resolveConfiguredPort } from './config-service.ts'
import { classifyHealthStatus, probeHealthz } from './health-service.ts'
import {
  findOrphanPids,
  isProcessManagedAlive,
  peekLastStderr,
  resolveCurrentBinaryPath,
} from './process-service.ts'

let lastError: string | null = null
let lastProgress: Wb2apiProgressEvent | null = null
let publishTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

/** 运行中定时探活：面板里加账号后 healthz 会变，需推 EVENT_STATE */
const STATE_POLL_MS = 3_000

export function setLastError(message: string | null): void {
  lastError = message
}

export function setLastProgress(progress: Wb2apiProgressEvent | null): void {
  lastProgress = progress
}

async function binaryInstalled(): Promise<boolean> {
  const p = await resolveCurrentBinaryPath()
  if (!p) return false
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export async function buildState(): Promise<Wb2apiPanelState> {
  const state = defaultWb2apiPanelState()
  const manifest = readManifest()
  const settings = readAppSettings()
  const config = await readConfigJson()
  const port = resolveConfiguredPort(config) || settings.port
  const installed = await binaryInstalled()

  state.installed = installed
  state.version = manifest?.version ?? null
  state.port = port
  state.panelUrl = buildWb2apiPanelUrl(port)
  state.apiKey = typeof config?.api_key === 'string' && config.api_key.trim()
    ? config.api_key.trim()
    : null
  state.lastError = lastError || (peekLastStderr() || null)
  state.updating = isInstallBusy()
  state.progress = lastProgress

  if (!installed) {
    state.status = 'not_installed'
    return state
  }

  if (isInstallBusy()) {
    state.status = 'updating'
    return state
  }

  const alive = isProcessManagedAlive()
  if (!alive) {
    const orphans = await findOrphanPids(port)
    state.orphanLikely = orphans.length > 0
    // 主动 STOP 会 clearLastStderr，避免关停日志冒充错误
    state.status = lastError ? 'error' : 'stopped'
    return state
  }

  const health = await probeHealthz(port)
  if (!health.ok) {
    state.status = 'unhealthy'
    return state
  }
  state.status = classifyHealthStatus(health)
  state.lastError = null
  return state
}

export function publishStateSoon(): void {
  if (publishTimer) return
  publishTimer = setTimeout(() => {
    publishTimer = null
    void publishStateNow()
  }, 200)
}

export async function publishStateNow(): Promise<Wb2apiPanelState> {
  const state = await buildState()
  broadcastToWindows(WB2API_PANEL_IPC_CHANNELS.EVENT_STATE, state, {
    onError: error => logger.warn('wb2api state broadcast failed', { error: error.message }),
  })
  return state
}

export function startStatePublisher(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    // 未运行且未在安装/更新时跳过，避免空转 IPC
    if (!isProcessManagedAlive() && !isInstallBusy()) return
    void publishStateNow().catch((error: unknown) => {
      logger.warn('wb2api state poll failed', { error: (error as Error).message })
    })
  }, STATE_POLL_MS)
}

export function stopStatePublisher(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (publishTimer) {
    clearTimeout(publishTimer)
    publishTimer = null
  }
}
