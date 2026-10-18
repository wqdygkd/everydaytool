// Microsoft Store 解析：双源合并 —— 文件列表来自 store.rg-adguard.net，
// 产品元数据来自 displaycatalog.mp.microsoft.com。任一成功即返回。
import type { OfflinePackMsStoreFile, OfflinePackMsStoreResolveResult } from '../../../../shared/offline-pack.ts'
import { fetchJson, postForm } from '../utils/http.ts'

type RequestType = 'url' | 'ProductId' | 'PackageFamilyName' | 'CategoryId'

const RG_URL = 'https://store.rg-adguard.net/api/GetFiles'
const DISPLAY_CATALOG_URL = 'https://displaycatalog.mp.microsoft.com/v7.0/products'

const PRODUCT_ID_PATTERN = /^[A-Z0-9]{12}$/i
const PACKAGE_FAMILY_NAME_PATTERN = /^[A-Z0-9][\w.-]*_[A-Z0-9]+$/i
const CATEGORY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isDisplayCatalogBigId(value: string): boolean {
  return PRODUCT_ID_PATTERN.test(value)
}

function isStoreIdentifier(value: string): boolean {
  return /^[A-Z0-9]{12,16}$/i.test(value)
}

function detectRequestType(query: string): RequestType | null {
  const value = query.trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return 'url'
  if (/(?:^|\/)(?:apps\.microsoft\.com|microsoft\.com\/\S*store)/i.test(value)) return 'url'
  if (CATEGORY_ID_PATTERN.test(value)) return 'CategoryId'
  if (PACKAGE_FAMILY_NAME_PATTERN.test(value)) return 'PackageFamilyName'
  if (PRODUCT_ID_PATTERN.test(value)) return 'ProductId'
  return null
}

function extractStoreIdentifierFromUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (isStoreIdentifier(trimmed)) return trimmed.toUpperCase()

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  const fromQuery
    = parsed.searchParams.get('productId')
      ?? parsed.searchParams.get('productid')
      ?? parsed.searchParams.get('itemId')
      ?? parsed.searchParams.get('itemid')
  if (fromQuery && isStoreIdentifier(fromQuery)) return fromQuery.toUpperCase()

  const path = parsed.pathname
  const patterns = [
    /\/detail\/([A-Z0-9]{12,16})(?:[/?#]|$)/i,
    /\/store\/productid\/([A-Z0-9]{12,16})(?:[/?#]|$)/i,
    /\/productid\/([A-Z0-9]{12,16})(?:[/?#]|$)/i,
  ]
  for (const pattern of patterns) {
    const matched = path.match(pattern)
    if (matched?.[1]) return matched[1].toUpperCase()
  }
  return null
}

function normalizeStoreIdentifier(type: RequestType, query: string): string {
  const trimmed = query.trim()
  if (!trimmed) throw new Error('query 不能为空')
  switch (type) {
    case 'url': {
      const id = extractStoreIdentifierFromUrl(trimmed)
      if (!id) throw new Error('无法从 URL 提取应用标识')
      return trimmed
    }
    case 'ProductId': {
      if (!isDisplayCatalogBigId(trimmed)) throw new Error('无效 ProductId（需 12 位，例如 9N0DX20HK701）')
      return trimmed.toUpperCase()
    }
    case 'PackageFamilyName': {
      if (!PACKAGE_FAMILY_NAME_PATTERN.test(trimmed)) throw new Error('无效 PackageFamilyName')
      return trimmed
    }
    case 'CategoryId': {
      if (!CATEGORY_ID_PATTERN.test(trimmed)) throw new Error('无效 CategoryId')
      return trimmed.toLowerCase()
    }
  }
}

function mapRequestTypeForRg(type: RequestType): string {
  return type === 'CategoryId' ? 'CategoryID' : type
}

function decodeHtml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', '\'')
}

function stripHtml(value: string): string {
  return decodeHtml(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeRgLanguage(language: string): string {
  const [base, region] = language.split('-')
  if (!base || !region) return language
  return `${base.toLowerCase()}-${region.toUpperCase()}`
}

function parseRgHtml(html: string): { categoryId?: string, files: OfflinePackMsStoreFile[] } {
  const categoryMatch = html.match(/CategoryID:\s*<\/b>\s*<i>([^<]+)<\/i>/i)
  const categoryId = categoryMatch?.[1]?.trim()

  const files: OfflinePackMsStoreFile[] = []
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let matched: RegExpExecArray | null = rowRegex.exec(html)
  while (matched) {
    const rowHtml = matched[1] ?? ''
    const linkMatch = rowHtml.match(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/i)
    if (!linkMatch?.[1] || !linkMatch[2]) {
      matched = rowRegex.exec(html)
      continue
    }
    const cellValues = Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi))
      .map(cell => stripHtml(cell[1] ?? ''))
      .filter(Boolean)

    const expires = cellValues.length >= 4 ? cellValues[1] ?? '' : ''
    const hash = cellValues.length >= 4
      ? cellValues[cellValues.length - 2] ?? ''
      : cellValues.length >= 2 ? cellValues[cellValues.length - 1] ?? '' : ''
    const size = cellValues.length >= 4 ? cellValues[cellValues.length - 1] ?? '' : ''

    files.push({ url: decodeHtml(linkMatch[1]), name: decodeHtml(linkMatch[2]), expires, sha1: hash, size })
    matched = rowRegex.exec(html)
  }
  return { categoryId, files }
}

async function fetchRgFiles(params: { type: RequestType, query: string }): Promise<{ categoryId?: string, files: OfflinePackMsStoreFile[] }> {
  const language = 'en-us'
  const html = await postForm<string>(RG_URL, {
    type: mapRequestTypeForRg(params.type),
    url: params.query,
    ring: 'RP',
    lang: normalizeRgLanguage(language),
  }, {
    headers: {
      Origin: 'https://store.rg-adguard.net',
      Referer: 'https://store.rg-adguard.net/',
    },
  })
  const parsed = parseRgHtml(html)
  if (parsed.files.length === 0) {
    throw new Error('下载接口未返回可用文件')
  }
  return parsed
}

export async function resolveMsStore(query: string): Promise<OfflinePackMsStoreResolveResult> {
  const type = detectRequestType(query)
  if (!type) {
    throw new Error('无法识别输入类型，请输入 Microsoft Store 链接、ProductId（12 位）、PackageFamilyName 或 CategoryId（UUID）')
  }

  const market = 'US'
  const language = 'en-us'
  const storeIdentifier = normalizeStoreIdentifier(type, query)

  // 1) rg-adguard 文件列表（失败不阻断，后续以 filesError 透出）
  let files: OfflinePackMsStoreFile[] | undefined
  let filesError: string | undefined
  let categoryId: string | undefined
  try {
    const rgResult = await fetchRgFiles({ type, query: storeIdentifier })
    files = rgResult.files
    categoryId = rgResult.categoryId
  } catch (error) {
    filesError = error instanceof Error ? error.message : String(error)
  }

  // 2) Display Catalog 产品元数据（仅 bigId 可映射时）
  let product: Record<string, unknown> | undefined
  const bigId = type === 'ProductId' || type === 'url'
    ? (type === 'ProductId' ? storeIdentifier : extractStoreIdentifierFromUrl(storeIdentifier))
    : null
  if (bigId && isDisplayCatalogBigId(bigId)) {
    const url = `${DISPLAY_CATALOG_URL}?bigIds=${encodeURIComponent(bigId)}&market=${market}&languages=${language}`
    try {
      const data = await fetchJson<{ Products?: Array<Record<string, unknown>> }>(url, {
        headers: { 'Accept-Language': `${language},en-us;q=0.8` },
      })
      product = data.Products?.[0]
    } catch {
      // 元数据失败可容忍，文件列表兜底
    }
  }

  if (!product && !files?.length) {
    throw new Error(filesError || '未找到对应产品，请检查 ProductId 或链接')
  }

  const localizedList = (product?.LocalizedProperties ?? []) as Array<Record<string, unknown>>
  const productProperties = (product?.Properties ?? {}) as Record<string, unknown>
  const localized = localizedList.find(item => String(item.Language ?? '').toLowerCase() === language) ?? localizedList[0] ?? {}

  return {
    productId: String(product?.ProductId ?? extractStoreIdentifierFromUrl(storeIdentifier) ?? storeIdentifier),
    title: String(localized.ProductTitle ?? ''),
    publisherName: String(localized.PublisherName ?? ''),
    description: String(localized.ProductDescription ?? ''),
    lastModifiedDate: typeof product?.LastModifiedDate === 'string' ? product.LastModifiedDate : undefined,
    packageFamilyNames: Array.isArray(productProperties.PackageFamilyNames)
      ? (productProperties.PackageFamilyNames as Array<unknown>).map(p => String(p))
      : [],
    market,
    language,
    categoryId,
    files,
    filesSource: files ? 'rg-adguard' : undefined,
    filesError,
  }
}
