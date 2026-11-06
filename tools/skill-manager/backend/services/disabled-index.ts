import type { SkillManagerDisabledEntry, SkillManagerDisabledIndex } from '../../../../shared/skill-manager.ts'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeTextAtomic } from './executor.ts'

export function disabledScopeDirName(scopeId: string): string {
  return scopeId.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'scope'
}

export function getDisabledScopeDir(root: string, scopeId: string): string {
  return join(root, disabledScopeDirName(scopeId))
}

export function getDisabledIndexPath(root: string, scopeId: string): string {
  return join(getDisabledScopeDir(root, scopeId), 'index.json')
}

export function emptyDisabledIndex(scopeId: string): SkillManagerDisabledIndex {
  return { version: 1, scopeId, entries: {} }
}

export async function readDisabledIndex(root: string, scopeId: string): Promise<SkillManagerDisabledIndex> {
  try {
    const raw = await readFile(getDisabledIndexPath(root, scopeId), 'utf8')
    const parsed = JSON.parse(raw) as SkillManagerDisabledIndex
    if (parsed?.version !== 1 || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) {
      return emptyDisabledIndex(scopeId)
    }
    return { version: 1, scopeId, entries: parsed.entries }
  }
  catch {
    return emptyDisabledIndex(scopeId)
  }
}

export async function writeDisabledIndex(index: SkillManagerDisabledIndex, root: string): Promise<void> {
  await mkdir(getDisabledScopeDir(root, index.scopeId), { recursive: true })
  await writeTextAtomic(getDisabledIndexPath(root, index.scopeId), `${JSON.stringify(index, null, 2)}\n`)
}

export async function listDisabledScopeIds(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  }
  catch {
    return []
  }
}

export async function listAllDisabledEntries(root: string): Promise<SkillManagerDisabledEntry[]> {
  const result: SkillManagerDisabledEntry[] = []
  for (const scopeDir of await listDisabledScopeIds(root)) {
    const index = await readDisabledIndex(root, scopeDir)
    result.push(...Object.values(index.entries))
  }
  return result
}
