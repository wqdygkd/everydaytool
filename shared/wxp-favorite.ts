import type { WxpLinkFavorite } from './wxp.ts'

function textOf(value: unknown): string {
  return String(value ?? '').trim()
}

/** 对象原样规范化；旧版 `|` 拼接字符串拆成对象。对不上的条目丢掉。 */
export function parseWxpLinkFavorite(item: unknown): WxpLinkFavorite | null {
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>
    const simpleName = textOf(record.simpleName)
    if (!simpleName) return null
    return {
      sceneformal: textOf(record.sceneformal),
      simpleName,
      accessPoint: textOf(record.accessPoint),
      targetPoint: textOf(record.targetPoint),
      hospital: textOf(record.hospital),
      tenantId: textOf(record.tenantId),
      code: textOf(record.code),
    }
  }
  if (typeof item !== 'string' || !item.includes('|')) return null
  const parts = item.split('|')
  const simpleName = textOf(parts[1])
  if (!simpleName) return null
  return {
    sceneformal: textOf(parts[0]),
    simpleName,
    accessPoint: textOf(parts[2]),
    targetPoint: textOf(parts.slice(3).join('|')),
    hospital: '',
    tenantId: '',
    code: '',
  }
}

export function sameWxpLinkFavorite(a: WxpLinkFavorite, b: WxpLinkFavorite): boolean {
  return a.sceneformal === b.sceneformal
    && a.simpleName === b.simpleName
    && a.accessPoint === b.accessPoint
    && a.targetPoint === b.targetPoint
}

export function normalizeWxpLinkFavorites(raw: unknown): WxpLinkFavorite[] {
  if (!Array.isArray(raw)) return []
  const out: WxpLinkFavorite[] = []
  for (const item of raw) {
    const parsed = parseWxpLinkFavorite(item)
    if (parsed) out.push(parsed)
  }
  return out
}
