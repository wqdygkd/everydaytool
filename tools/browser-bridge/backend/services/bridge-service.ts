// 浏览器桥总调度：装配 WS 桥 / MITM 代理 / 证书 / 名单 / 规则（动态脚本由规则派生下发）/ 流量，
// 并向渲染层广播状态事件（chrome-sandbox 的广播模式同款）。
import type { BridgeRule, BridgeRuntimeStatus, BridgeTarget, CaStatus, InjectedScript, TargetMatchType, TrafficEntry } from '../../../../shared/browser-bridge.ts'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { isDev } from '../../../../backend/utils/data-root.ts'
import { copyPath, pathExists, readJson, readJsonFile, writeJson } from '../../../../backend/utils/file-ops.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { BRIDGE_WS_PORT_BASE, BRIDGE_WS_PORT_RANGE } from '../../../../shared/browser-bridge.ts'
import { BROWSER_BRIDGE_IPC_CHANNELS } from '../ipc/channels.ts'
import { getConfigSnapshot, loadConfig, resetConfigStore, saveConfig, setTargets } from '../store/config-store.ts'
import { deleteRule, getRulesSnapshot, loadRules, resetRulesStore, upsertRule } from '../store/rules-store.ts'
import { getBridgeDataDirectory, getCaCertPath, getExtensionSourcePath, getRuntimeExtensionPath } from '../utils/paths.ts'
import { getCaTrustState, installCaTrust, uninstallCaTrust } from './ca-trust.ts'
import { ensureRootCa, isRootCaGenerated, readRootCa, resetCertCaches } from './cert-service.ts'
import { createProxyService } from './proxy-service.ts'
import { compileScriptRules } from './script-compile.ts'
import { formatTargetHost, isLoopbackHost, normalizeHost } from './target-list.ts'
import { addTrafficEntry, clearTrafficEntries, listTrafficEntries, suggestHostsForUrl } from './traffic-store.ts'
import { createWsBridge } from './ws-bridge.ts'

const CA_STATUS_CACHE_MS = 3_000

function emit(channel: string, payload: unknown): void {
  broadcastToWindows(channel, payload, {
    onError: error => logger.warn('Bridge broadcast failed', { channel, error: error.message }),
  })
}

let initialized = false
let extensionDir: string | null = null
let caStatusCache: { at: number, status: CaStatus } | null = null

let wsBridge: ReturnType<typeof createWsBridge>

const proxyService = createProxyService({
  getTargets: () => getConfigSnapshot().targets,
  getRules: () => getRulesSnapshot(),
  onTraffic: (entry: TrafficEntry) => {
    addTrafficEntry(entry)
    emit(BROWSER_BRIDGE_IPC_CHANNELS.EVENT_TRAFFIC, entry)
  },
  isOwnPort: (port) => {
    const wsPort = wsBridge.getPort()
    const proxyPort = proxyService.getPort()
    return port === wsPort || port === proxyPort
  },
})

wsBridge = createWsBridge({
  getToken: () => getConfigSnapshot().token,
  getTargets: () => getConfigSnapshot().targets,
  getScripts: () => getExtensionScripts(),
  getProxyPort: () => proxyService.getPort(),
  suggestHosts: url => suggestHostsForUrl(url),
  onAddTarget: (url, matchType) => {
    void addTargetFromUrl(url, matchType)
  },
  onRemoveTarget: (host, port) => {
    void removeTargetMatching(host, port)
  },
  onConnectionsChanged: () => {
    emitRuntimeStatus()
  },
  onProxyStateReported: (clientId, enabled, error) => {
    logger.info('Extension proxy state reported', { clientId, enabled, error })
  },
  onScriptLog: (clientId, scriptId, level, message) => {
    logger.info('Injected script log', { clientId, scriptId, level, message })
  },
})

function emitRuntimeStatus(): void {
  emit(BROWSER_BRIDGE_IPC_CHANNELS.EVENT_STATUS, buildRuntimeStatus())
}

function emitTargetsChanged(): void {
  emit(BROWSER_BRIDGE_IPC_CHANNELS.EVENT_TARGETS, getConfigSnapshot().targets)
}

function buildRuntimeStatus(): BridgeRuntimeStatus {
  return {
    wsPort: wsBridge.getPort(),
    proxyPort: proxyService.getPort(),
    proxyRunning: proxyService.isRunning(),
    connections: wsBridge.getConnections(),
    extensionDir,
    token: getConfigSnapshot().token,
  }
}

/** 打包态把扩展资源复制到 userData 稳定路径（安装目录可变，load unpacked 的路径必须稳） */
async function prepareExtensionDirectory(): Promise<string> {
  const source = getExtensionSourcePath()
  if (isDev) return source

  const target = getRuntimeExtensionPath()
  try {
    const [sourceManifest, targetManifest] = await Promise.all([
      readJson<{ version?: string }>(path.join(source, 'manifest.json')),
      pathExists(path.join(target, 'manifest.json'))
        .then(exists => exists ? readJson<{ version?: string }>(path.join(target, 'manifest.json')) : null),
    ])
    if (!targetManifest || targetManifest.version !== sourceManifest.version) {
      await copyPath(source, target)
      logger.info('Extension resources copied', { target, version: sourceManifest.version })
    }
  } catch (error) {
    logger.warn('Failed to prepare extension directory', { error: (error as Error).message })
  }
  return target
}

// ---------------------------------------------------------------------------
// 处理名单
// ---------------------------------------------------------------------------

function targetKey(host: string, port?: number, matchType?: TargetMatchType): string {
  return `${normalizeHost(host)}|${port ?? ''}|${matchType ?? ''}`
}

export async function addTargetFromUrl(url: string, matchType: TargetMatchType = 'exact'): Promise<BridgeTarget | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const host = parsed.hostname
  // 回环目标必须带端口，避免圈进本机所有服务
  const port = isLoopbackHost(host) && parsed.port ? Number(parsed.port) : undefined
  return addTarget(host, port, matchType)
}

export async function addTarget(host: string, port: number | undefined, matchType: TargetMatchType): Promise<BridgeTarget | null> {
  await loadConfig()
  const targets = getConfigSnapshot().targets
  const normalizedHost = normalizeHost(host)
  if (!normalizedHost) return null

  const existing = targets.find(target =>
    targetKey(target.host, target.port, target.matchType) === targetKey(normalizedHost, port, matchType),
  )
  if (existing) return existing

  const target: BridgeTarget = {
    id: randomUUID(),
    host: normalizedHost,
    port: matchType === 'exact' ? port : undefined,
    matchType,
    createdAt: new Date().toISOString(),
  }
  setTargets([...targets, target])
  await saveConfig()
  wsBridge.broadcast({ type: 'targets-sync', targets: getConfigSnapshot().targets })
  emitTargetsChanged()
  logger.info('Target added', { target: formatTargetHost(normalizedHost, port), matchType })
  return target
}

export async function removeTargetMatching(host: string, port?: number): Promise<boolean> {
  await loadConfig()
  const targets = getConfigSnapshot().targets
  const normalizedHost = normalizeHost(host)
  const next = targets.filter((target) => {
    if (normalizeHost(target.host) !== normalizedHost) return true
    if (port !== undefined && target.port !== undefined && target.port !== port) return true
    return false
  })
  if (next.length === targets.length) return false
  setTargets(next)
  await saveConfig()
  wsBridge.broadcast({ type: 'targets-sync', targets: next })
  emitTargetsChanged()
  return true
}

export async function removeTargetById(targetId: string): Promise<boolean> {
  await loadConfig()
  const targets = getConfigSnapshot().targets
  const next = targets.filter(target => target.id !== targetId)
  if (next.length === targets.length) return false
  setTargets(next)
  await saveConfig()
  wsBridge.broadcast({ type: 'targets-sync', targets: next })
  emitTargetsChanged()
  return true
}

// ---------------------------------------------------------------------------
// 规则（动态脚本规则编译为 InjectedScript 随规则变更一并下发扩展）
// ---------------------------------------------------------------------------

/** 脚本规则 → 扩展可直接注册的注入脚本列表（见 script-compile.ts） */
function getExtensionScripts(): InjectedScript[] {
  return compileScriptRules(getRulesSnapshot())
}

function syncScriptsToExtension(): void {
  wsBridge.broadcast({ type: 'scripts-sync', scripts: getExtensionScripts() })
}

export async function saveRule(rule: BridgeRule): Promise<void> {
  await loadRules()
  await upsertRule({ ...rule, updatedAt: new Date().toISOString() })
  syncScriptsToExtension()
}

export async function removeRule(ruleId: string): Promise<void> {
  await loadRules()
  await deleteRule(ruleId)
  syncScriptsToExtension()
}

/** 旧版独立脚本（scripts.json）一次性迁移为 script 规则；迁移后旧文件清空（幂等） */
async function migrateLegacyScripts(): Promise<void> {
  const legacyPath = path.join(getBridgeDataDirectory(), 'scripts.json')
  try {
    const raw = await readJsonFile<{ scripts?: InjectedScript[] }>(legacyPath, {})
    const legacy = Array.isArray(raw.scripts) ? raw.scripts : []
    if (!legacy.length) return
    let migrated = 0
    for (const script of legacy) {
      if (!script?.id || getRulesSnapshot().some(rule => rule.id === script.id)) continue
      const pattern = script.matches?.find(match => match && match !== '*://*/*')
      await upsertRule({
        id: script.id,
        name: script.name || '未命名脚本',
        enabled: script.enabled !== false,
        type: 'script',
        source: pattern
          ? { key: 'url', operator: 'wildcard', value: pattern }
          : { key: 'url', operator: 'contains', value: '' },
        script: {
          code: script.code ?? '',
          world: script.world ?? 'MAIN',
          runAt: script.runAt ?? 'document_start',
        },
        updatedAt: script.updatedAt || new Date().toISOString(),
      })
      migrated += 1
    }
    await writeJson(legacyPath, { scripts: [] })
    logger.info('Legacy scripts migrated to script rules', { migrated, total: legacy.length })
  } catch (error) {
    logger.warn('Legacy scripts migration skipped', { error: (error as Error).message })
  }
}

// ---------------------------------------------------------------------------
// 代理开关 / CA
// ---------------------------------------------------------------------------

/** 从 edt 页面强制扩展挂载 / 摘除代理（等价 popup 开关；扩展连上才生效） */
export function setProxyDesired(enabled: boolean): boolean {
  const clientIds = wsBridge.getActiveClientIds()
  for (const clientId of clientIds) {
    wsBridge.sendTo(clientId, { type: 'set-proxy', enabled })
  }
  return clientIds.length > 0
}

export async function getCaStatus(force = false): Promise<CaStatus> {
  if (!force && caStatusCache && Date.now() - caStatusCache.at < CA_STATUS_CACHE_MS) {
    return caStatusCache.status
  }

  const generated = await isRootCaGenerated()
  const root = generated ? await readRootCa() : null
  let status: CaStatus

  if (!root) {
    status = {
      generated: false,
      platform: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'unsupported',
      trustState: 'not-found',
      fingerprint: '',
      commonName: 'edt Browser Bridge CA',
      certPath: '',
    }
  } else {
    const trust = await getCaTrustState(root.fingerprint)
    status = {
      generated: true,
      platform: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'unsupported',
      trustState: trust.state,
      fingerprint: root.fingerprint,
      commonName: root.commonName,
      certPath: getCaCertPath(),
      detail: trust.detail,
    }
  }

  caStatusCache = { at: Date.now(), status }
  return status
}

export interface CaActionResult {
  ok: boolean
  canceled?: boolean
  detail?: string
  status: CaStatus
}

export async function installCa(): Promise<CaActionResult> {
  await ensureRootCa()
  const result = await installCaTrust(getCaCertPath())
  caStatusCache = null
  const status = await getCaStatus(true)
  emitRuntimeStatus()
  return { ok: result.ok, canceled: result.canceled, detail: result.detail, status }
}

export async function uninstallCa(): Promise<CaActionResult> {
  const root = await readRootCa()
  if (!root) {
    const status = await getCaStatus(true)
    return { ok: true, status }
  }
  const result = await uninstallCaTrust(root.fingerprint)
  caStatusCache = null
  const status = await getCaStatus(true)
  emitRuntimeStatus()
  return { ok: result.ok, canceled: result.canceled, detail: result.detail, status }
}

/** 导出根证书到用户选定路径（手动导入兜底用） */
export async function exportCaCert(destPath: string): Promise<void> {
  const root = await ensureRootCa()
  await writeFile(destPath, root.certPem, 'utf8')
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

export const browserBridgeService = {
  async initialize(): Promise<void> {
    if (initialized) return
    initialized = true
    await loadConfig()
    await loadRules()
    await migrateLegacyScripts()
    try {
      await ensureRootCa()
    } catch (error) {
      logger.warn('Root CA init failed (will retry on demand)', { error: (error as Error).message })
    }
    extensionDir = await prepareExtensionDirectory()
    await proxyService.start()
    await wsBridge.start(BRIDGE_WS_PORT_BASE, BRIDGE_WS_PORT_RANGE)
    logger.info('Browser bridge started', { proxyPort: proxyService.getPort(), wsPort: wsBridge.getPort() })
  },

  onDataDirectoryChanged(): void {
    // 数据目录切换：配置/规则/证书全部换址，内存缓存与流量一并丢弃
    resetConfigStore()
    resetRulesStore()
    resetCertCaches()
    clearTrafficEntries()
    caStatusCache = null
    // 扩展运行时目录随数据目录换址（打包态在 userData 下），需重新解析
    extensionDir = null
    void (async () => {
      await loadConfig()
      extensionDir = await prepareExtensionDirectory()
      emitRuntimeStatus()
    })()
  },

  async dispose(): Promise<void> {
    await wsBridge.stop()
    await proxyService.stop()
  },

  getRuntimeStatus: buildRuntimeStatus,
  getTraffic: listTrafficEntries,
  clearTraffic: clearTrafficEntries,
}
