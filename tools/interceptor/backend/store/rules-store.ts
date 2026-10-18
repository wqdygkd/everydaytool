// interceptor 规则存储（data/interceptor/rules.json）。
import type { InterceptorRule } from '../../../../shared/interceptor.ts'
import path from 'node:path'
import { readJsonFile, writeJson } from '../../../../backend/utils/file-ops.ts'
import { getInterceptorDataDirectory } from '../utils/paths.ts'

interface RulesFile {
  rules: InterceptorRule[]
}

let cache: InterceptorRule[] | null = null

function getRulesPath(): string {
  return path.join(getInterceptorDataDirectory(), 'rules.json')
}

export async function loadRules(): Promise<InterceptorRule[]> {
  if (cache) return cache
  const raw = await readJsonFile<Partial<RulesFile>>(getRulesPath(), {})
  cache = Array.isArray(raw.rules) ? raw.rules : []
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
  await writeJson(getRulesPath(), { rules } satisfies RulesFile)
  return rules
}

export async function deleteRule(ruleId: string): Promise<InterceptorRule[]> {
  await loadRules()
  const rules = (cache ?? []).filter(rule => rule.id !== ruleId)
  cache = rules
  await writeJson(getRulesPath(), { rules } satisfies RulesFile)
  return rules
}

export function resetRulesStore(): void {
  cache = null
}
