// 拦截器总调度：装配 WS 桥 / MITM 代理 / 证书 / 名单 / 规则（动态脚本由规则派生下发）/ 流量，
// 并向渲染层广播状态事件（chrome-sandbox 的广播模式同款）。
import type {
  CaStatus,
  InjectedScript,
  InterceptorRule,
  InterceptorRuleSummary,
  InterceptorRuntimeStatus,
  InterceptorTarget,
  InterceptorTargetPatch,
  TrafficEntry,
} from '../../../../shared/interceptor.ts'
import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { isDev } from '../../../../backend/utils/data-root.ts'
import { copyPath, pathExists, readJson, readJsonFile, writeJson } from '../../../../backend/utils/file-ops.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import {
  INTERCEPTOR_PROXY_PORT_MAX,
  INTERCEPTOR_PROXY_PORT_MIN,
  INTERCEPTOR_WS_PORT_BASE,
  INTERCEPTOR_WS_PORT_RANGE,
  originOf,
  parseTargetOrigin,
  RULE_TYPE_LABELS,
} from '../../../../shared/interceptor.ts'
import { INTERCEPTOR_IPC_CHANNELS } from '../ipc/channels.ts'
import { getConfigSnapshot, loadConfig, resetConfigStore, saveConfig, setProxyPort as setConfigProxyPort, setTargets } from '../store/config-store.ts'
import { deleteRule, getRulesSnapshot, loadRules, resetRulesStore, upsertRule } from '../store/rules-store.ts'
import { getCaCertPath, getExtensionSourcePath, getInterceptorDataDirectory, getLegacyRuntimeExtensionPath, getRuntimeExtensionPath } from '../utils/paths.ts'
import { getCaTrustState, installCaTrust, uninstallCaTrust } from './ca-trust.ts'
import { ensureRootCa, isRootCaGenerated, readRootCa, resetCertCaches } from './cert-service.ts'
import { createProxyService } from './proxy-service.ts'
import { ruleAppliesToHost } from './rule-engine.ts'
import { compileScriptRules } from './script-compile.ts'
import { normalizeHost } from './target-list.ts'
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
/** 代理端口降级说明（配置端口不可用时改用随机端口的原因，供 UI 如实展示） */
let proxyPortNote: string | null = null

let wsBridge: ReturnType<typeof createWsBridge>

const proxyService = createProxyService({
  getTargets: () => getConfigSnapshot().targets,
  getRules: () => getRulesSnapshot(),
  onTraffic: (entry: TrafficEntry) => {
    addTrafficEntry(entry)
    emit(INTERCEPTOR_IPC_CHANNELS.EVENT_TRAFFIC, entry)
  },
  isOwnPort: (port) => {
    const wsPort = wsBridge.getPort()
    const proxyPort = proxyService.getPort()
    return port === wsPort || port === proxyPort
  },
})

wsBridge = createWsBridge({
  getTargets: () => getConfigSnapshot().targets,
  getScripts: () => getExtensionScripts(),
  getRuleSummaries: () => getRuleSummaries(),
  getProxyPort: () => proxyService.getPort(),
  suggestHosts: url => suggestHostsForUrl(url),
  onAddTarget: (url) => {
    void addTargetFromUrl(url)
  },
  onToggleTarget: (id, enabled) => {
    void setTargetEnabled(id, enabled)
  },
  onRemoveTargetById: (id) => {
    void removeTargetById(id)
  },
  onToggleRule: (id, enabled) => {
    void setRuleEnabled(id, enabled)
  },
  onRemoveRule: (id) => {
    void removeRule(id)
  },
  getSiteInfo: url => getSiteInfo(url),
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
  emit(INTERCEPTOR_IPC_CHANNELS.EVENT_STATUS, buildRuntimeStatus())
}

function emitTargetsChanged(): void {
  emit(INTERCEPTOR_IPC_CHANNELS.EVENT_TARGETS, getTargets())
}

function buildRuntimeStatus(): InterceptorRuntimeStatus {
  return {
    wsPort: wsBridge.getPort(),
    proxyPort: proxyService.getPort(),
    proxyRunning: proxyService.isRunning(),
    proxyPortNote: proxyPortNote ?? undefined,
    connections: wsBridge.getConnections(),
    extensionDir,
  }
}

/** 打包态把扩展资源复制到数据目录稳定路径（安装目录可变，load unpacked 的路径必须稳） */
async function prepareExtensionDirectory(): Promise<string> {
  const source = getExtensionSourcePath()
  if (isDev) return source

  const target = getRuntimeExtensionPath()
  try {
    // 早期版本在 userData；先搬到数据目录，避免登录/配置散落在 userData
    const legacy = getLegacyRuntimeExtensionPath()
    if (!await pathExists(path.join(target, 'manifest.json')) && await pathExists(path.join(legacy, 'manifest.json'))) {
      await copyPath(legacy, target)
      await rm(legacy, { recursive: true, force: true }).catch(() => {})
      logger.info('Legacy interceptor extension moved to data directory', { target })
    }
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
// 处理名单（白名单闸门：一个条目 = 一个 origin；命中才进处理层并跑规则）
// ---------------------------------------------------------------------------

export interface AddTargetResult {
  /** 归一后的条目（失败为 null） */
  target: InterceptorTarget | null
  /** true = 名单里已有同一 origin，本次没有新增 */
  existed: boolean
}

/** 弹窗「加入名单」：只取当前页面的 origin（`https://www.a.com`，端口按 origin 语义保留） */
export async function addTargetFromUrl(url: string): Promise<InterceptorTarget | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return (await addTarget(originOf(parsed.protocol === 'https:' ? 'https' : 'http', parsed.hostname, parsed.port ? Number(parsed.port) : undefined))).target
}

/** 新增名单条目（origin 级）：已存在则视为幂等，返回 existed */
export async function addTarget(rawOrigin: string): Promise<AddTargetResult> {
  await loadConfig()
  const targets = getConfigSnapshot().targets
  const origin = parseTargetOrigin(rawOrigin)
  if (!origin) return { target: null, existed: false }

  const existing = targets.find(target => target.origin === origin)
  if (existing) {
    logger.info('Target already exists', { target: origin })
    return { target: existing, existed: true }
  }

  const target: InterceptorTarget = {
    id: randomUUID(),
    origin,
    enabled: true,
    // 默认强制回源：不开的话浏览器命中缓存就没有请求，流量页会莫名空白
    noCache: true,
    createdAt: new Date().toISOString(),
  }
  setTargets([...targets, target])
  await saveConfig()
  broadcastTargets()
  logger.info('Target added', { target: origin })
  return { target, existed: false }
}

/** 名单变更统一出口：扩展（targets-sync）+ 渲染层（EVENT_TARGETS），并让旧隧道失效 */
function broadcastTargets(): void {
  const targets = getConfigSnapshot().targets
  // 浏览器会长期复用已建立的 CONNECT 隧道：名单变了必须断开旧的透传隧道，
  // 否则新加的 origin 对"已经连着的"连接不生效（表现就是"加了名单却看不到这条请求"）。
  const closed = proxyService.closeTransparentTunnels()
  if (closed > 0) logger.info('Closed transparent tunnels after target change', { closed })
  wsBridge.broadcast({ type: 'targets-sync', targets })
  emitTargetsChanged()
}

/** 下发用名单（扩展 / 渲染层同一份） */
export function getTargets(): InterceptorTarget[] {
  return getConfigSnapshot().targets
}

export async function setTargetEnabled(targetId: string, enabled: boolean): Promise<boolean> {
  return updateTarget(targetId, { enabled })
}

/** 条目开关补丁（字段定义在 shared，IPC 与渲染层共用一份） */
export type TargetPatch = InterceptorTargetPatch

/** 条目开关更新（启用 / 强制回源），返回是否真的改了东西 */
export async function updateTarget(targetId: string, patch: TargetPatch): Promise<boolean> {
  await loadConfig()
  const targets = getConfigSnapshot().targets
  let changed = false
  const next = targets.map((target) => {
    if (target.id !== targetId) return target
    const merged: InterceptorTarget = { ...target }
    if (patch.enabled !== undefined && patch.enabled !== (target.enabled !== false)) merged.enabled = patch.enabled
    if (patch.noCache !== undefined && patch.noCache !== (target.noCache !== false)) merged.noCache = patch.noCache
    if (merged.enabled === target.enabled && merged.noCache === target.noCache) return target
    changed = true
    return merged
  })
  if (!changed) {
    logger.info('Target update ignored (no change)', { targetId, patch })
    return false
  }
  setTargets(next)
  await saveConfig()
  broadcastTargets()
  logger.info('Target updated', { targetId, patch })
  return true
}

export async function removeTargetById(targetId: string): Promise<boolean> {
  await loadConfig()
  const targets = getConfigSnapshot().targets
  const next = targets.filter(target => target.id !== targetId)
  if (next.length === targets.length) return false
  setTargets(next)
  await saveConfig()
  broadcastTargets()
  return true
}

// ---------------------------------------------------------------------------
// 规则（动态脚本规则编译为 InjectedScript 随规则变更一并下发扩展）
// ---------------------------------------------------------------------------

/** 脚本规则 → 扩展可直接注册的注入脚本列表（见 script-compile.ts） */
function getExtensionScripts(): InjectedScript[] {
  return compileScriptRules(getRulesSnapshot())
}

const SOURCE_KEY_LABELS: Record<InterceptorRule['source']['key'], string> = { url: 'URL', host: '主机', path: '路径' }
const SOURCE_OPERATOR_LABELS: Record<InterceptorRule['source']['operator'], string> = {
  equals: '等于',
  contains: '包含',
  matches: '匹配',
  wildcard: '通配',
}

function summarizeRule(rule: InterceptorRule, scope?: 'global' | 'site'): InterceptorRuleSummary {
  return {
    id: rule.id,
    name: rule.name,
    type: rule.type,
    typeLabel: RULE_TYPE_LABELS[rule.type],
    enabled: rule.enabled,
    condition: `${SOURCE_KEY_LABELS[rule.source.key]}${SOURCE_OPERATOR_LABELS[rule.source.operator]}${rule.source.value}`,
    source: rule.source,
    ...(scope ? { scope } : {}),
    updatedAt: rule.updatedAt,
  }
}

function getRuleSummaries(): InterceptorRuleSummary[] {
  return getRulesSnapshot().map(rule => summarizeRule(rule))
}

export interface SiteInfo {
  targets: InterceptorTarget[]
  /** 同主机但 origin 不同的条目（弹窗折叠展示：「你配的是 http，这个页面是 https」这类原因） */
  related: InterceptorTarget[]
  rules: InterceptorRuleSummary[]
  /** 名单总条数（弹窗显示「本站 X / 共 Y」） */
  total: number
}

/**
 * 当前站点的弹窗数据：
 * - targets：origin 命中该页面的条目（不看 enabled，弹窗要能显示并切换禁用项）；
 * - related：同主机但 origin 不同（协议 / 端口不一致）的条目，避免「明明配了却看不到」；
 * - rules：**按域**筛出该站点可用得上的规则（域约束同站 / 不绑定域），不是拿单条流量去匹配路径；
 *   同站规则排在前面，全局规则在后。
 */
export function getSiteInfo(url: string): SiteInfo {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    const all = getConfigSnapshot().targets
    return { targets: [], related: [], rules: [], total: all.length }
  }
  const host = normalizeHost(parsed.hostname)
  const origin = originOf(parsed.protocol === 'https:' ? 'https' : 'http', parsed.hostname, parsed.port ? Number(parsed.port) : undefined)

  const all = getConfigSnapshot().targets
  const targets: InterceptorTarget[] = []
  const related: InterceptorTarget[] = []
  for (const target of all) {
    if (target.origin === origin) {
      targets.push(target)
      continue
    }
    // 同主机但协议 / 端口不同：名单按 origin 精确匹配，这类条目不会生效，但要让人看到
    if (targetOriginHost(target.origin) === host) related.push(target)
  }

  const rules: InterceptorRuleSummary[] = []
  for (const rule of getRulesSnapshot()) {
    const scope = ruleAppliesToHost(rule, host)
    if (!scope) continue
    rules.push(summarizeRule(rule, scope))
  }
  rules.sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'site' ? -1 : 1))
  return { targets, related, rules, total: all.length }
}

/** 从 origin 里取主机（`https://[::1]:8089` → `::1`） */
function targetOriginHost(origin: string): string {
  try {
    return normalizeHost(new URL(origin).hostname)
  } catch {
    return ''
  }
}

function syncScriptsToExtension(): void {
  wsBridge.broadcast({ type: 'scripts-sync', scripts: getExtensionScripts() })
}

function syncRulesToExtension(): void {
  wsBridge.broadcast({ type: 'rules-sync', rules: getRuleSummaries() })
}

export async function saveRule(rule: InterceptorRule): Promise<void> {
  await loadRules()
  await upsertRule({ ...rule, updatedAt: new Date().toISOString() })
  syncScriptsToExtension()
  syncRulesToExtension()
}

export async function setRuleEnabled(ruleId: string, enabled: boolean): Promise<boolean> {
  await loadRules()
  const rule = getRulesSnapshot().find(item => item.id === ruleId)
  if (!rule) return false
  await upsertRule({ ...rule, enabled, updatedAt: new Date().toISOString() })
  syncScriptsToExtension()
  syncRulesToExtension()
  return true
}

export async function removeRule(ruleId: string): Promise<void> {
  await loadRules()
  await deleteRule(ruleId)
  syncScriptsToExtension()
  syncRulesToExtension()
}

/** 旧版独立脚本（scripts.json）一次性迁移为 script 规则；迁移后旧文件清空（幂等） */
async function migrateLegacyScripts(): Promise<void> {
  const legacyPath = path.join(getInterceptorDataDirectory(), 'scripts.json')
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
// 代理端口（首次随机分配并落盘后固定；用户可手动修改）
// ---------------------------------------------------------------------------

/** 按配置启动代理：配置端口可用则沿用（固定不变），不可用则重新随机一个并落盘 */
async function startProxyOnConfiguredPort(): Promise<void> {
  const configured = getConfigSnapshot().proxyPort
  if (configured !== null) {
    try {
      await proxyService.start(configured)
      proxyPortNote = null
      logger.info('Proxy started on configured port', { port: configured })
      return
    } catch (error) {
      proxyPortNote = `端口 ${configured} 不可用，已改用随机端口`
      logger.warn('Configured proxy port unavailable, using a random port', { port: configured, error: (error as Error).message })
    }
  }

  const assigned = await proxyService.start(null)
  setConfigProxyPort(assigned)
  await saveConfig()
  logger.info('Proxy port assigned', { port: assigned })
}

export interface ProxyPortChangeResult {
  ok: boolean
  error?: string
}

/** 手动改代理端口：新端口可用才落盘，失败回滚原端口（不让用户把代理弄停） */
export async function changeProxyPort(nextPort: number): Promise<ProxyPortChangeResult> {
  if (!Number.isInteger(nextPort) || nextPort < INTERCEPTOR_PROXY_PORT_MIN || nextPort > INTERCEPTOR_PROXY_PORT_MAX) {
    return { ok: false, error: `端口需在 ${INTERCEPTOR_PROXY_PORT_MIN}–${INTERCEPTOR_PROXY_PORT_MAX} 之间` }
  }

  const previous = proxyService.getPort()
  if (previous === nextPort) return { ok: true }

  await proxyService.stop()
  try {
    await proxyService.start(nextPort)
  } catch (error) {
    if (previous !== null) {
      await proxyService.start(previous).catch((rollbackError: Error) => {
        logger.error('Proxy port rollback failed', { port: previous, error: rollbackError.message })
      })
    }
    emitRuntimeStatus()
    return { ok: false, error: `端口 ${nextPort} 不可用：${(error as Error).message}` }
  }

  setConfigProxyPort(nextPort)
  await saveConfig()
  proxyPortNote = null
  // 已连接的扩展要按新端口重新挂载，否则浏览器仍会把流量发往旧端口
  wsBridge.broadcast({ type: 'proxy-port', proxyPort: nextPort })
  emitRuntimeStatus()
  logger.info('Proxy port changed', { from: previous, to: nextPort })
  return { ok: true }
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
      commonName: 'edt Interceptor CA',
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

export const interceptorService = {
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
    await startProxyOnConfiguredPort()
    await wsBridge.start(INTERCEPTOR_WS_PORT_BASE, INTERCEPTOR_WS_PORT_RANGE)
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
      // 端口配置也随目录换了：按新配置重启代理，避免「配置显示 A / 实际监听 B」
      try {
        await proxyService.stop()
        await startProxyOnConfiguredPort()
      } catch (error) {
        proxyPortNote = '代理重启失败，请在状态页检查端口'
        logger.error('Proxy restart after data directory change failed', { error: (error as Error).message })
      }
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
