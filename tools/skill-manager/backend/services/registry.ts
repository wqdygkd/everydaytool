import type {
  SkillManagerGroupRecord,
  SkillManagerRecord,
  SkillManagerRegistry,
  SkillManagerScopeRegistry,
} from '../../../../shared/skill-manager.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'

export function emptySkillManagerRegistry(): SkillManagerRegistry {
  return { version: 1, scopes: {}, groups: {} }
}

export function readSkillManagerRegistry(path: string): SkillManagerRegistry {
  const value = readJsonDocument<SkillManagerRegistry>(path, emptySkillManagerRegistry)
  if (!value || value.version !== 1 || typeof value.scopes !== 'object' || typeof value.groups !== 'object') {
    return emptySkillManagerRegistry()
  }
  return value
}

export function writeSkillManagerRegistry(registry: SkillManagerRegistry, path: string): void {
  writeJsonDocument(path, registry)
}

export function getScopeRegistry(registry: SkillManagerRegistry, scopeId: string): SkillManagerScopeRegistry {
  return registry.scopes[scopeId] ?? { records: {} }
}

export function upsertRecord(
  registry: SkillManagerRegistry,
  scopeId: string,
  name: string,
  record: SkillManagerRecord,
): void {
  const scope = registry.scopes[scopeId] ?? { records: {} }
  scope.records[name] = record
  registry.scopes[scopeId] = scope
}

export function upsertGroup(
  registry: SkillManagerRegistry,
  groupKey: string,
  update: Partial<SkillManagerGroupRecord>,
): SkillManagerGroupRecord {
  const existing = registry.groups[groupKey] ?? {
    selectedNames: [],
    installedNames: [],
    disabledNames: [],
    lastFetchedNames: [],
  }
  const group = { ...existing, ...update }
  registry.groups[groupKey] = group
  return group
}
