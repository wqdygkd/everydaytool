// Edge Add-ons 代理：搜索 / 详情（官方 JSON API）+ CRX 下载 URL 构建。
import type { OfflinePackEdgeDetail, OfflinePackEdgeSearchItem } from '../../../../shared/offline-pack.ts'
import { parseEdgeQuery } from '../../../../shared/offline-pack.ts'
import { fetchJson } from '../utils/http.ts'

const EDGE_MARKET = 'US'
const EDGE_LANGUAGE = 'en-US'
const EDGE_DOWNLOAD_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'

interface EdgeSearchResponseItem {
  crxId?: string
  storeProductId?: string
  name?: string
  developerName?: string
  shortDescription?: string
  logoUrl?: string
}

export async function searchEdge(query: string): Promise<OfflinePackEdgeSearchItem[]> {
  const url = new URL('https://microsoftedge.microsoft.com/addons/v4/getfilteredorderedsearch')
  url.searchParams.set('hl', EDGE_LANGUAGE)
  url.searchParams.set('gl', EDGE_MARKET)
  url.searchParams.set('Query', query)
  url.searchParams.set('pgNo', '1')
  url.searchParams.set('filteredCategories', 'Edge-Extensions')
  url.searchParams.set('filteredAddon', '1')
  url.searchParams.set('filterFeaturedAddons', 'false')
  url.searchParams.set('filteredRating', '0')
  url.searchParams.set('sortBy', 'Relevance')

  const data = await fetchJson<{ extensionList?: EdgeSearchResponseItem[] }>(url.toString(), {
    headers: { 'Accept': 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
  })
  const list = data.extensionList ?? []
  return list
    .filter((item): item is EdgeSearchResponseItem & { crxId: string, name: string } =>
      typeof item.crxId === 'string' && typeof item.name === 'string')
    .slice(0, 10)
    .map(item => ({
      id: item.crxId,
      storeProductId: item.storeProductId,
      name: item.name,
      developer: item.developerName,
      description: item.shortDescription,
      iconUrl: item.logoUrl,
    }))
}

function normalizeAssetUrl(url?: string): string | undefined {
  if (!url) return undefined
  return url.startsWith('//') ? `https:${url}` : url
}

export async function getEdgeDetail(query: string): Promise<OfflinePackEdgeDetail> {
  const parsed = parseEdgeQuery(query)
  if (!parsed) {
    throw new Error('无效的 Edge 扩展 ID、ProductId 或商店链接')
  }
  const base = parsed.type === 'crxId'
    ? `https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/${parsed.value}`
    : `https://microsoftedge.microsoft.com/addons/getproductdetails/${parsed.value}`
  const url = new URL(base)
  url.searchParams.set('hl', EDGE_LANGUAGE)
  url.searchParams.set('gl', EDGE_MARKET)

  const data = await fetchJson<Record<string, unknown>>(url.toString(), {
    headers: { 'Accept': 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
  })

  return {
    id: typeof data.crxId === 'string' ? data.crxId : parsed.type === 'crxId' ? parsed.value : '',
    storeProductId: typeof data.storeProductId === 'string' ? data.storeProductId : undefined,
    name: typeof data.name === 'string' ? data.name : undefined,
    version: typeof data.version === 'string' ? data.version : undefined,
    developer: typeof data.developer === 'string' ? data.developer : undefined,
    category: typeof data.category === 'string' ? data.category : undefined,
    description: typeof data.description === 'string' ? data.description.trim() : undefined,
    shortDescription: typeof data.shortDescription === 'string' ? data.shortDescription.trim() : undefined,
    rating: typeof data.averageRating === 'number' ? data.averageRating : undefined,
    ratingCount: typeof data.ratingCount === 'number' ? data.ratingCount : undefined,
    activeInstallCount: typeof data.activeInstallCount === 'number' ? data.activeInstallCount : undefined,
    iconUrl: normalizeAssetUrl(typeof data.logoUrl === 'string' ? data.logoUrl : undefined),
    isFeatured: typeof data.isBadgedAsFeatured === 'boolean' ? data.isBadgedAsFeatured : undefined,
  }
}

export function buildEdgeDownloadUrl(id: string): string {
  const url = new URL('https://edge.microsoft.com/extensionwebstorebase/v1/crx')
  url.searchParams.set('response', 'redirect')
  url.searchParams.set('x', `id=${id}&installsource=ondemand&uc`)
  return url.toString()
}

export { EDGE_DOWNLOAD_USER_AGENT }
