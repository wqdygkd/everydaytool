// interceptor 规则存储（data/interceptor/rules.json）。
import type { InterceptorRule } from '../../../../shared/interceptor.ts'
import path from 'node:path'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { getInterceptorDataDirectory } from '../utils/paths.ts'
import { sanitizeStoredRule } from './rule-validation.ts'

interface RulesFile {
  rules: InterceptorRule[]
}

let cache: InterceptorRule[] | null = null

function getRulesPath(): string {
  return path.join(getInterceptorDataDirectory(), 'rules.json')
}

export async function loadRules(): Promise<InterceptorRule[]> {
  if (cache) return cache
  const raw = readJsonDocument<Partial<RulesFile>>(getRulesPath(), () => ({}))
  const stored = Array.isArray(raw.rules) ? raw.rules : []
  const rules = stored
    .map(sanitizeStoredRule)
    .filter((rule): rule is InterceptorRule => rule !== null)
  cache = rules
  if (rules.length !== stored.length) {
    logger.warn('Dropped invalid interceptor rules', { dropped: stored.length - rules.length })
    writeJsonDocument(getRulesPath(), { rules } satisfies RulesFile)
  }
  return cache
}

export function getRulesSnapshot(): InterceptorRule[] {
  return cache ?? []
}

export async function upsertRule(rule: InterceptorRule): Promise<InterceptorRule[]> {
  await loadRules()
  const rules = cache ?? []
  const index = rules.findIndex(item => item.id === rule.id)
  if (index >= 0) rules[index] = rule
  else rules.push(rule)
  writeJsonDocument(getRulesPath(), { rules } satisfies RulesFile)
  return rules
}

export async function deleteRule(ruleId: string): Promise<InterceptorRule[]> {
  await loadRules()
  const rules = (cache ?? []).filter(rule => rule.id !== ruleId)
  cache = rules
  writeJsonDocument(getRulesPath(), { rules } satisfies RulesFile)
  return rules
}

export function resetRulesStore(): void {
  cache = null
}
