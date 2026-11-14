import type { InterceptorRule, RuleFilters, RuleSource } from '../../../../shared/interceptor.ts'
import { RESOURCE_TYPE_LABELS, RULE_TYPE_LABELS } from '../../../../shared/interceptor.ts'

const SOURCE_KEYS = new Set(['url', 'host', 'path'])
const SOURCE_OPERATORS = new Set(['equals', 'contains', 'matches', 'wildcard'])
const FILTER_OPERATORS = new Set(['equals', 'contains'])
const RESOURCE_TYPES = new Set(Object.keys(RESOURCE_TYPE_LABELS))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 规则来源必须能安全交给 matchSource：key / operator 是枚举，value 是非空字符串 */
export function normalizeRuleSource(value: unknown): RuleSource | null {
  if (!isRecord(value)) return null
  const { key, operator, value: sourceValue } = value
  if (typeof key !== 'string' || !SOURCE_KEYS.has(key)) return null
  if (typeof operator !== 'string' || !SOURCE_OPERATORS.has(operator)) return null
  if (typeof sourceValue !== 'string' || !sourceValue.trim()) return null
  return { key: key as RuleSource['key'], operator: operator as RuleSource['operator'], value: sourceValue }
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return null
  return value as string[]
}

/** 过滤器结构校验；undefined 表示未配置，null 表示结构非法 */
export function normalizeRuleFilters(value: unknown): RuleFilters | null | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return null

  const filters: RuleFilters = {}
  if (value.requestMethod !== undefined) {
    const methods = stringArray(value.requestMethod)
    if (!methods) return null
    filters.requestMethod = methods
  }
  if (value.resourceType !== undefined) {
    const types = stringArray(value.resourceType)
    if (!types || types.some(type => !RESOURCE_TYPES.has(type))) return null
    filters.resourceType = types as RuleFilters['resourceType']
  }
  if (value.pageUrl !== undefined) {
    if (typeof value.pageUrl !== 'string') return null
    filters.pageUrl = value.pageUrl
  }
  if (value.requestPayload !== undefined) {
    if (!isRecord(value.requestPayload)) return null
    const { key, operator, value: payloadValue } = value.requestPayload
    if (typeof key !== 'string' || !key.trim()) return null
    if (typeof operator !== 'string' || !FILTER_OPERATORS.has(operator)) return null
    if (typeof payloadValue !== 'string') return null
    filters.requestPayload = {
      key,
      operator: operator as NonNullable<RuleFilters['requestPayload']>['operator'],
      value: payloadValue,
    }
  }
  return filters
}

/** 从磁盘读取的规则：结构不合格直接丢弃（由调用方记日志并回写干净数据） */
export function sanitizeStoredRule(value: unknown): InterceptorRule | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !value.id.trim()) return null
  if (typeof value.name !== 'string' || !value.name.trim()) return null
  if (typeof value.enabled !== 'boolean') return null
  if (typeof value.type !== 'string' || !(value.type in RULE_TYPE_LABELS)) return null

  const source = normalizeRuleSource(value.source)
  if (!source) return null
  const filters = normalizeRuleFilters(value.filters)
  if (filters === null) return null

  return {
    ...(value as unknown as InterceptorRule),
    source,
    ...(filters === undefined ? {} : { filters }),
  }
}
