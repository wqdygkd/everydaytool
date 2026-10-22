// interceptor 配置存储（data/interceptor/config.json）：代理端口 + 处理名单。
// 与规则/脚本分文件，便于用户手动查看与迁移。
import type { InterceptorTarget } from '../../../../shared/interceptor.ts'
import type { InterceptorConfigData } from '../types.ts'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { readJsonFile, writeJson } from '../../../../backend/utils/file-ops.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { INTERCEPTOR_PROXY_PORT_MAX, INTERCEPTOR_PROXY_PORT_MIN, normalizeTargetHostInput, originOf, parseTargetOrigin } from '../../../../shared/interceptor.ts'
import { getInterceptorDataDirectory } from '../utils/paths.ts'

const EMPTY_CONFIG: InterceptorConfigData = { proxyPort: null, targets: [] }

let cache: InterceptorConfigData | null = null

function getConfigPath(): string {
  return path.join(getInterceptorDataDirectory(), 'config.json')
}

function parsePort(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= INTERCEPTOR_PROXY_PORT_MIN && value <= INTERCEPTOR_PROXY_PORT_MAX
    ? value
    : null
}

interface ParsedTargets {
  targets: InterceptorTarget[]
  /** 结构有变更（需要回写磁盘） */
  migrated: boolean
}

/**
 * 名单条目归一化（v5：一个条目 = 一个 origin，白名单闸门）：
 * - v5：`{ id, origin, enabled }`，origin 走 `parseTargetOrigin` 归一（默认端口省略、scheme/host 小写）；
 * - v4 及更早（`host` + 可选 `port`）：按 origin 重建——**回环目标用 http，其余用 https**，
 *   端口保留；老的 `includeSubdomains` / `matchReferrer` / `disabledHosts` 字段废弃丢弃
 *   （子域与第三方归属不再属于名单职责，需要时请加对应 origin 或改用规则）；
 * - v3（`source = { key, operator, value }`）：从值里取主机；`matches`（正则）无法用 origin 表达，丢弃；
 * - v2（`host` + `matchType`）：`exact / contains / suffix` 都只保留主机，`regex` 丢弃。
 * 迁移会记一条日志，方便用户知道哪些老条目被收窄了。
 */
function parseTargets(raw: unknown): ParsedTargets {
  if (!Array.isArray(raw)) return { targets: [], migrated: raw !== undefined }
  const targets: InterceptorTarget[] = []
  const seen = new Set<string>()
  let migrated = false

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      migrated = true
      continue
    }
    const candidate = item as Record<string, unknown>

    const origin = targetOriginFromRecord(candidate)
    if (!origin) {
      logger.warn('Dropped unmigratable target', { entry: candidate })
      migrated = true
      continue
    }
    if (candidate.origin !== origin) migrated = true
    // 迁移后可能撞车（老的「整站」+「某 URL」两条都归一成同一个 origin）：合并成一条
    if (seen.has(origin)) {
      migrated = true
      continue
    }
    seen.add(origin)

    if (candidate.enabled === undefined || candidate.createdAt === undefined) migrated = true
    if (candidate.includeSubdomains !== undefined || candidate.matchReferrer !== undefined || candidate.disabledHosts !== undefined) migrated = true
    // 老条目没有「强制回源」开关：默认打开（保持"能看到请求"的既有行为），回写成显式字段
    if (typeof candidate.noCache !== 'boolean') migrated = true

    let id = typeof candidate.id === 'string' ? candidate.id : ''
    if (!id) {
      id = randomUUID()
      migrated = true
    }

    targets.push({
      id,
      origin,
      enabled: candidate.enabled !== false,
      noCache: candidate.noCache !== false,
      createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString(),
    })
  }

  return { targets, migrated }
}

/** v3 的 source 形态（仅迁移用） */
interface LegacySource {
  key?: unknown
  operator?: unknown
  value?: unknown
}

function isLoopbackLabel(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase()
  return bare === 'localhost' || bare === '::1' || bare.startsWith('127.')
}

/** 一条已存记录 → origin（v5 直接读，老结构按主机 + 默认 scheme 重建），不合法返回 null */
function targetOriginFromRecord(candidate: Record<string, unknown>): string | null {
  if (typeof candidate.origin === 'string') return parseTargetOrigin(candidate.origin)
  const legacy = legacyTargetOf(candidate)
  if (!legacy) return null
  // 老条目没有协议信息：回环是本地服务（http），其余按 https 处理
  return originOf(isLoopbackLabel(legacy.host) ? 'http' : 'https', legacy.host, legacy.port)
}

/** 从 v2 / v3 / v4 的老条目里取出主机与端口（正则条目无法在 origin 级表达，返回 null） */
function legacyTargetOf(candidate: Record<string, unknown>): { host: string, port?: number } | null {
  const source = candidate.source as LegacySource | undefined
  if (source && typeof source === 'object' && typeof source.value === 'string') {
    if (source.operator === 'matches') return null
    return normalizeTargetHostInput(source.value)
  }

  if (candidate.matchType === 'regex') return null
  const rawHost = typeof candidate.host === 'string' ? candidate.host.trim() : ''
  if (!rawHost) return null
  const parsedHost = normalizeTargetHostInput(rawHost)
  if (!parsedHost) return null
  const port = typeof candidate.port === 'number' && Number.isInteger(candidate.port) && candidate.port > 0 && candidate.port <= 65535
    ? candidate.port
    : parsedHost.port
  return { host: parsedHost.host, port }
}

/** 读取配置；首次访问把迁移后的结构落盘（旧版 token 字段丢弃、名单结构归一化） */
export async function loadConfig(): Promise<InterceptorConfigData> {
  if (cache) return cache

  const raw = await readJsonFile<Partial<InterceptorConfigData> & { token?: string }>(getConfigPath(), {})
  const parsed = parseTargets(raw.targets)
  const config: InterceptorConfigData = {
    proxyPort: parsePort(raw.proxyPort),
    targets: parsed.targets,
  }
  cache = config
  // 需要重写：缺字段 / 名单结构迁移 / 旧版 token 残留（已取消配对码）
  if (!('proxyPort' in raw) || parsed.migrated || 'token' in raw) {
    await writeJson(getConfigPath(), config)
  }
  return config
}

export async function saveConfig(): Promise<void> {
  if (!cache) return
  await writeJson(getConfigPath(), cache)
}

export function getConfigSnapshot(): InterceptorConfigData {
  return cache ?? EMPTY_CONFIG
}

export function setTargets(targets: InterceptorConfigData['targets']): void {
  if (!cache) return
  cache.targets = targets
}

export function setProxyPort(port: number | null): void {
  if (!cache) return
  cache.proxyPort = port
}

/** 数据目录切换后丢弃缓存，下次访问按新目录加载 */
export function resetConfigStore(): void {
  cache = null
}
