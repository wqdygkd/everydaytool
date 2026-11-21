import process from 'node:process'
import { session } from 'electron'
import { logger } from '../../../../backend/utils/logger.ts'
import { getSettings, listAccountPartitions } from '../store/outlook-store.ts'

const ALLOWED_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks4:', 'socks5:', 'socks:'])

/** 空字符串表示直连；只接受 http(s) / socks 代理地址 */
export function normalizeOutlookProxy(value: unknown): string {
  if (typeof value !== 'string') throw new Error('代理地址必须是字符串')
  const raw = value.trim()
  if (!raw) return ''
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('代理地址格式不正确，例如 http://127.0.0.1:7897')
  }
  if (!ALLOWED_PROXY_PROTOCOLS.has(url.protocol)) {
    throw new Error('代理只支持 http / https / socks4 / socks5 协议')
  }
  if (!url.hostname) throw new Error('代理地址缺少主机名')
  if (url.pathname && url.pathname !== '/') throw new Error('代理地址不能带路径')
  return raw
}

function buildOutlookUserAgent(): string {
  const chromeVersion = process.versions.chrome || '131.0.0.0'
  const platform = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : 'X11; Linux x86_64'
  // 去掉 Electron token：微软登录页会把 Electron 当成不受支持的嵌入浏览器
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
}

export async function prepareOutlookSession(partition: string): Promise<void> {
  const target = session.fromPartition(partition)
  target.setUserAgent(buildOutlookUserAgent(), 'zh-CN,zh;q=0.9,en;q=0.8')
  const proxy = getSettings().proxy
  if (proxy) {
    await target.setProxy({ proxyRules: proxy, proxyBypassRules: '<local>' })
  } else {
    await target.setProxy({ mode: 'direct' })
  }
  // setProxy 不会自动断开既有连接，旧连接会继续直连
  await target.closeAllConnections()
}

export async function resetOutlookSession(partition: string): Promise<void> {
  const target = session.fromPartition(partition)
  try {
    await target.clearStorageData()
    await target.clearCache()
    await target.closeAllConnections()
  } catch (error) {
    logger.warn('Failed to reset Outlook session', {
      partition,
      error: (error as Error).message,
    })
    throw error
  }
}

export async function applyOutlookSettingsToAllSessions(): Promise<void> {
  const partitions = listAccountPartitions()
  const results = await Promise.allSettled(partitions.map(partition => prepareOutlookSession(partition)))
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      logger.warn('Failed to apply Outlook session settings', {
        partition: partitions[index],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  }
}
