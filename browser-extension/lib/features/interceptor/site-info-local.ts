import type {
  InterceptorRuleSummary,
  InterceptorTarget,
  RuleSource,
} from '../../../../shared/interceptor.ts'
import { interceptorState } from './state.ts'

const TWO_LEVEL_SUFFIXES = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac'])

function registrableDomain(host: string): string {
  const parts = String(host || '').toLowerCase().split('.')
  if (parts.length <= 2) return parts.join('.')
  if (TWO_LEVEL_SUFFIXES.has(parts[parts.length - 2]!)) return parts.slice(-3).join('.')
  return parts.slice(-2).join('.')
}

export function originOfUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}`
  }
  catch {
    return undefined
  }
}

export function originHostOf(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  }
  catch {
    return ''
  }
}

function localSourceHostPattern(rule: { source?: RuleSource }): string | undefined {
  const source = rule.source
  if (!source) return undefined
  const raw = String(source.value ?? '').trim()
  if (!raw) return undefined
  if (source.key === 'host') return raw
  if (source.key === 'url') {
    if (source.operator === 'matches') return undefined
    const byScheme = /^[a-z*]+:\/\/([^/?#]+)/i.exec(raw)
    if (byScheme?.[1]) return byScheme[1]
    if (!raw.includes('/') && /^[\w.*:-]+$/.test(raw) && raw.includes('.')) return raw
  }
  return undefined
}

function localHostMatchesPattern(pattern: string, host: string, operator?: string): boolean {
  const value = pattern.replace(/:\d+$/, '').toLowerCase()
  if (!value || value === '*') return true
  if (operator === 'matches') {
    try {
      return new RegExp(value).test(host)
    }
    catch {
      return false
    }
  }
  if (value.startsWith('*.')) {
    const base = value.slice(2)
    if (host === base || host.endsWith(`.${base}`)) return true
  }
  if (value.includes('*') || value.includes('?')) {
    const escaped = value.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
    if (new RegExp(`^${escaped}$`).test(host)) return true
  }
  if (operator === 'contains' && host.includes(value)) return true
  if (value === host) return true
  if (host.endsWith(`.${value}`) || value.endsWith(`.${host}`)) return true
  return registrableDomain(host) === registrableDomain(value)
}

function localRuleScope(rule: InterceptorRuleSummary, host: string): 'global' | 'site' | null {
  const pattern = localSourceHostPattern(rule)
  if (pattern === undefined) return 'global'
  if (/^[\s*?:]*$/.test(pattern)) return 'global'
  return localHostMatchesPattern(pattern, host, rule.source?.operator) ? 'site' : null
}

export type LocalSiteInfo = {
  targets: InterceptorTarget[]
  related: InterceptorTarget[]
  rules: Array<InterceptorRuleSummary & { scope: 'global' | 'site' }>
  total: number
}

/** edt 不回 site-info 时的域级过滤兜底 */
export function localSiteInfo(rawUrl: string): LocalSiteInfo {
  let url: URL
  try {
    url = new URL(rawUrl)
  }
  catch {
    return { targets: [], related: [], rules: [], total: interceptorState.targets.length }
  }
  const host = url.hostname.toLowerCase()
  const pageOrigin = originOfUrl(rawUrl)

  const targets: InterceptorTarget[] = []
  const related: InterceptorTarget[] = []
  for (const target of interceptorState.targets) {
    if (target.origin === pageOrigin) targets.push(target)
    else if (originHostOf(target.origin) === host) related.push(target)
  }

  const rules: Array<InterceptorRuleSummary & { scope: 'global' | 'site' }> = []
  for (const rule of interceptorState.rules) {
    const scope = rule.source ? localRuleScope(rule, host) : 'global'
    if (!scope) continue
    rules.push({ ...rule, scope })
  }
  rules.sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'site' ? -1 : 1))
  return { targets, related, rules, total: interceptorState.targets.length }
}
