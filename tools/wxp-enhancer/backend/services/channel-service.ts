import type {
  WxpChannelLink,
  WxpChannelSnapshot,
  WxpChannelTogglePayload,
  WxpChannelToggleResult,
  WxpHospitalOption,
} from '../../../../shared/wxp.ts'
import { evaluateOnMainPage } from './cdp-client.ts'
import { buildChannelSnapshotExpression, buildChannelToggleExpression } from './channel-collector.ts'

/** 转发列表缓存：端口每 3s 轮询一次，列表 30s 才重拉一次，避免持续打中间件接口 */
const LINKS_TTL_MS = 30_000

interface CachedLinks {
  code: string
  links: WxpChannelLink[]
  at: number
}

let cachedLinks: CachedLinks | null = null

/** 会话结束 / 换医院 / WXP 重启后清掉，避免把上一次会话的列表当成本次 */
export function resetChannelCache(): void {
  cachedLinks = null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asPortList(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => Math.round(Number(item)))
    .filter(port => Number.isInteger(port) && port > 0 && port <= 65535)
}

function normalizeHospitals(value: unknown): WxpHospitalOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const row = asRecord(item)
    const code = asString(row.code)
    if (!code) return []
    return [{ code, name: asString(row.name, code), branchid: asString(row.branchid) }]
  })
}

function normalizeLinks(value: unknown, ports: number[]): WxpChannelLink[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const row = asRecord(item)
    const localPort = asNumber(row.localPort)
    const localIp = asString(row.localIp)
    if (!localPort) return []
    return [{
      id: asString(row.id),
      name: asString(row.name),
      simpleName: asString(row.simpleName),
      sceneformal: asString(row.sceneformal),
      accessPoint: asString(row.accessPoint),
      targetPoint: asString(row.targetPoint),
      localIp,
      localPort,
      relIp: asString(row.relIp),
      relPort: asNumber(row.relPort),
      browsetype: asString(row.browsetype),
      operaPort: asNumber(row.operaPort),
      protocol: asString(row.protocol, 'http'),
      urlSuffix: asString(row.urlSuffix),
      canOpen: localIp === '127.0.0.1' || localIp === 'localhost',
      online: ports.includes(localPort),
    }]
  })
}

/**
 * 读取通道快照（只读镜像）。`hospitalCode` 为空时跟随 WXP 当前医院；
 * 端口集合每次都读，转发列表按 30s 缓存，切医院立即重拉。
 */
export async function readChannelSnapshot(port: number, hospitalCode = ''): Promise<WxpChannelSnapshot> {
  const target = hospitalCode.trim()
  const includeLinks = !cachedLinks || !target || cachedLinks.code !== target || Date.now() - cachedLinks.at > LINKS_TTL_MS
  const raw = asRecord(await evaluateOnMainPage(port, buildChannelSnapshotExpression(target, includeLinks)))
  const code = asString(raw.hospitalCode, target)
  const ports = asPortList(raw.onlinePorts)
  let links: WxpChannelLink[]

  if (includeLinks) {
    links = normalizeLinks(raw.links, ports)
    cachedLinks = { code, links, at: Date.now() }
  } else if (cachedLinks && cachedLinks.code === code) {
    links = cachedLinks.links.map(link => ({ ...link, online: ports.includes(link.localPort) }))
  } else {
    // 页面返回的医院与缓存不一致（期间在 WXP 里换了医院）：本轮先给空列表，下轮强制重拉
    cachedLinks = null
    links = []
  }

  const error = asString(raw.error)
  return {
    hospitals: normalizeHospitals(raw.hospitals),
    hospitalCode: code,
    currentCode: asString(raw.currentCode),
    links,
    onlinePorts: ports,
    collectedAt: Date.now(),
    error: error || undefined,
  }
}

/**
 * 建立 / 关闭通道。校验放在主进程侧：渲染层传上来的 payload 不信任。
 * 建立要求接入点是本机地址（与 WXP 自身 `openChannel` 的判定一致）。
 */
export async function toggleChannel(
  port: number,
  payload: WxpChannelTogglePayload,
  action: 'open' | 'close',
): Promise<WxpChannelToggleResult> {
  const hospitalCode = asString(payload?.hospitalCode).trim()
  const link = payload?.link
  if (!hospitalCode) throw new Error('请先选择医院')
  if (!link || typeof link !== 'object') throw new Error('缺少转发连接信息')
  const localPort = Math.round(Number(link.localPort))
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
    throw new Error('转发端口无效')
  }
  if (action === 'open') {
    if (!link.id) throw new Error('缺少转发标识')
    if (link.localIp !== '127.0.0.1' && link.localIp !== 'localhost') {
      throw new Error('接入点不是本机地址，无法在 WXP 内建立通道；请复制地址用外部浏览器访问')
    }
  }

  const raw = asRecord(await evaluateOnMainPage(
    port,
    buildChannelToggleExpression({ hospitalCode, link: { ...link, localPort } }, action),
  ))
  if (raw.ok !== true) {
    throw new Error(asString(raw.message) || (action === 'open' ? '建立通道失败' : '关闭通道失败'))
  }
  return {
    already: raw.already === true,
    ports: asPortList(raw.ports),
  }
}
