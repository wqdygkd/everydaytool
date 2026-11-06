import type { SkillManagerHistoryEntry, SkillManagerHistoryFile } from '../../../../shared/skill-manager.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'

const MAX_HISTORY_ENTRIES = 200

export function emptySkillManagerHistory(): SkillManagerHistoryFile {
  return { version: 1, entries: [] }
}

export function readSkillManagerHistory(path: string): SkillManagerHistoryFile {
  const value = readJsonDocument<SkillManagerHistoryFile>(path, emptySkillManagerHistory)
  if (!value || value.version !== 1 || !Array.isArray(value.entries)) return emptySkillManagerHistory()
  return value
}

export function markSkillManagerHistoryUndone(id: string, path: string): SkillManagerHistoryFile {
  const history = readSkillManagerHistory(path)
  const now = new Date().toISOString()
  const entries = history.entries.map(entry => entry.id === id ? { ...entry, undoneAt: now } : entry)
  const next: SkillManagerHistoryFile = { version: 1, entries }
  writeJsonDocument(path, next)
  return next
}

export function appendSkillManagerHistory(
  entry: SkillManagerHistoryEntry,
  path: string,
): SkillManagerHistoryFile {
  const history = readSkillManagerHistory(path)
  const entries = [entry, ...history.entries].slice(0, MAX_HISTORY_ENTRIES)
  const next: SkillManagerHistoryFile = { version: 1, entries }
  writeJsonDocument(path, next)
  return next
}
