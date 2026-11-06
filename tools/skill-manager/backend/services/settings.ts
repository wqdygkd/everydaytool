import type { SkillManagerSettings } from '../../../../shared/skill-manager.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'

export const DEFAULT_SKILL_MANAGER_SETTINGS: SkillManagerSettings = {
  autoReDisable: false,
  trashRetentionDays: 30,
  trashMaxBytes: 200 * 1024 * 1024,
  disabledLockPolicy: 'delete',
  defaultUpdatePolicy: 'safe',
  autoCheckIntervalHours: 24,
  removePolicy: 'trash',
  networkTimeoutMs: 15_000,
}

const MIN_TRASH_BYTES = 10 * 1024 * 1024
const MAX_TRASH_BYTES = 10 * 1024 * 1024 * 1024
const MIN_TIMEOUT_MS = 3_000
const MAX_TIMEOUT_MS = 120_000

export function normalizeSkillManagerSettings(input: Partial<SkillManagerSettings> | null | undefined): SkillManagerSettings {
  const days = Number(input?.trashRetentionDays)
  const bytes = Number(input?.trashMaxBytes)
  const interval = Number(input?.autoCheckIntervalHours)
  const timeout = Number(input?.networkTimeoutMs)
  return {
    autoReDisable: Boolean(input?.autoReDisable),
    trashRetentionDays: Number.isFinite(days) ? Math.min(365, Math.max(1, Math.round(days))) : DEFAULT_SKILL_MANAGER_SETTINGS.trashRetentionDays,
    trashMaxBytes: Number.isFinite(bytes) ? Math.min(MAX_TRASH_BYTES, Math.max(MIN_TRASH_BYTES, Math.round(bytes))) : DEFAULT_SKILL_MANAGER_SETTINGS.trashMaxBytes,
    disabledLockPolicy: input?.disabledLockPolicy === 'keep' ? 'keep' : 'delete',
    defaultUpdatePolicy: input?.defaultUpdatePolicy === 'sync' ? 'sync' : 'safe',
    autoCheckIntervalHours: Number.isFinite(interval) ? Math.min(168, Math.max(0, Math.round(interval))) : DEFAULT_SKILL_MANAGER_SETTINGS.autoCheckIntervalHours,
    removePolicy: input?.removePolicy === 'keep' ? 'keep' : 'trash',
    networkTimeoutMs: Number.isFinite(timeout) ? Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(timeout))) : DEFAULT_SKILL_MANAGER_SETTINGS.networkTimeoutMs,
  }
}

export function readSkillManagerSettings(path: string): SkillManagerSettings {
  const stored = readJsonDocument<Partial<SkillManagerSettings>>(path, () => ({}))
  return normalizeSkillManagerSettings(stored)
}

export function writeSkillManagerSettings(settings: SkillManagerSettings, path: string): SkillManagerSettings {
  const normalized = normalizeSkillManagerSettings(settings)
  writeJsonDocument(path, normalized)
  return normalized
}
