// browser-bridge 规则存储（data/browser-bridge/rules.json）。
import type { BridgeRule } from '../../../../shared/browser-bridge.ts'
import path from 'node:path'
import { readJsonFile, writeJson } from '../../../../backend/utils/file-ops.ts'
import { getBridgeDataDirectory } from '../utils/paths.ts'

interface RulesFile {
  rules: BridgeRule[]
}

let cache: BridgeRule[] | null = null

function getRulesPath(): string {
  return path.join(getBridgeDataDirectory(), 'rules.json')
}

export async function loadRules(): Promise<BridgeRule[]> {
  if (cache) return cache
  const raw = await readJsonFile<Partial<RulesFile>>(getRulesPath(), {})
  cache = Array.isArray(raw.rules) ? raw.rules : []
  return cache
}

export function getRulesSnapshot(): BridgeRule[] {
  return cache ?? []
}

export async function upsertRule(rule: BridgeRule): Promise<BridgeRule[]> {
  await loadRules()
  const rules = cache ?? []
  const index = rules.findIndex(item => item.id === rule.id)
  if (index >= 0) rules[index] = rule
  else rules.push(rule)
  await writeJson(getRulesPath(), { rules } satisfies RulesFile)
  return rules
}

export async function deleteRule(ruleId: string): Promise<BridgeRule[]> {
  await loadRules()
  const rules = (cache ?? []).filter(rule => rule.id !== ruleId)
  cache = rules
  await writeJson(getRulesPath(), { rules } satisfies RulesFile)
  return rules
}

export function resetRulesStore(): void {
  cache = null
}
