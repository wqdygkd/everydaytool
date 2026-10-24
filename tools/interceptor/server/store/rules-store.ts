// interceptor 规则存储（data/interceptor/rules.json）。
import type { InterceptorRule } from '../../../../shared/interceptor.ts'
import path from 'node:path'
import { JsonFileStore } from '../../../../server/utils/json-store.ts'
import { getInterceptorDataDirectory } from '../utils/paths.ts'

interface RulesFile {
  rules: InterceptorRule[]
}

const store = new JsonFileStore<RulesFile>(
  () => path.join(getInterceptorDataDirectory(), 'rules.json'),
  { rules: [] },
  raw => ({ rules: Array.isArray((raw as Partial<RulesFile>)?.rules) ? (raw as RulesFile).rules : [] }),
)

export async function loadRules(): Promise<InterceptorRule[]> {
  return store.get().rules
}

export function getRulesSnapshot(): InterceptorRule[] {
  return store.peek()?.rules ?? []
}

export async function upsertRule(rule: InterceptorRule): Promise<InterceptorRule[]> {
  store.update((file) => {
    const index = file.rules.findIndex(item => item.id === rule.id)
    if (index >= 0) file.rules[index] = rule
    else file.rules.push(rule)
  })
  return store.get().rules
}

export async function deleteRule(ruleId: string): Promise<InterceptorRule[]> {
  store.update((file) => {
    const index = file.rules.findIndex(rule => rule.id === ruleId)
    if (index >= 0) file.rules.splice(index, 1)
  })
  return store.get().rules
}

export function resetRulesStore(): void {
  store.reset()
}
