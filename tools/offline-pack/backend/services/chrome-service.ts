// Chrome Web Store 代理：搜索 / 详情（HTML 抓取）+ CRX 下载 URL 构建。
import type { OfflinePackChromeDetail, OfflinePackChromeSearchItem } from '../../../../shared/offline-pack.ts'
import { fetchText } from '../utils/http.ts'

export const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const CHROME_LANG = 'zh-CN,zh;q=0.9,en;q=0.8'

export async function searchChrome(query: string): Promise<OfflinePackChromeSearchItem[]> {
  const url = `https://chromewebstore.google.com/search/${encodeURIComponent(query)}`
  const html = await fetchText(url, { headers: { 'Accept-Language': CHROME_LANG, 'User-Agent': CHROME_UA } })

  // 从搜索结果 HTML 中提取 detail/{slug}/{32位ID}
  const entryRegex = /detail\/([^/]+)\/([a-z]{32})/g
  const seen = new Set<string>()
  const results: OfflinePackChromeSearchItem[] = []
  for (let match = entryRegex.exec(html); match !== null; match = entryRegex.exec(html)) {
    const [, slug, id] = match
    if (seen.has(id)) continue
    seen.add(id)
    // slug 转可读名："ublock-origin-lite" → "uBlock Origin Lite"
    const name = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    results.push({ id, name })
  }
  return results.slice(0, 10)
}

export async function getChromeDetail(id: string): Promise<OfflinePackChromeDetail> {
  const url = `https://chromewebstore.google.com/detail/${id}`
  const html = await fetchText(url, { headers: { 'Accept-Language': CHROME_LANG, 'User-Agent': CHROME_UA } })
  const titleRaw = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim()
  const name = titleRaw ? titleRaw.replace(/\s*[-–—]\s*Chrome.*$/i, '').trim() || undefined : undefined
  const descMatch = html.match(/meta\s+name="description"\s+content="([^"]*)"/)
  const description = descMatch?.[1]?.trim() || undefined
  return { id, name, description }
}

/** 构建 Chrome 更新服务 CRX 下载 URL */
export function buildChromeDownloadUrl(id: string): string {
  const params = new URLSearchParams({
    response: 'redirect',
    os: 'win',
    arch: 'x64',
    os_arch: 'x86_64',
    nacl_arch: 'x86-64',
    prod: 'chromecrx',
    prodchannel: 'beta',
    prodversion: '131.0.6778.86',
    lang: 'zh-CN',
    acceptformat: 'crx2,crx3',
    x: `id=${id}&installsource=ondemand&uc`,
  })
  return `https://clients2.google.com/service/update2/crx?${params.toString()}`
}

/** 提取 32 位扩展 ID（支持 URL 或裸 ID） */
export function extractChromeId(input: string): string {
  const trimmed = input.trim()
  const idMatch = trimmed.match(/([a-z]{32})/)
  if (idMatch) return idMatch[1]
  if (/^[a-z]{32}$/.test(trimmed.toLowerCase())) return trimmed.toLowerCase()
  throw new Error('无效的 Chrome 扩展 URL 或 ID')
}
