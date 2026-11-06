import type { Preset, PresetItem, PresetsFile, SkillOrigin } from '../../../../shared/skill-manager.ts'
import { randomUUID } from 'node:crypto'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { skillOriginKey } from '../../../../shared/skill-manager.ts'

export function emptyPresets(): PresetsFile {
  return { version: 1, presets: {} }
}

function validTarget(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const target = value as Record<string, unknown>
  return target.kind === 'global' || target.kind === 'project' || target.kind === 'custom'
}

function normalizeItem(value: unknown): PresetItem | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Record<string, unknown>
  if (typeof item.name !== 'string' || typeof item.installName !== 'string') return null
  if (typeof item.origin !== 'object' || item.origin === null) return null
  const origin = item.origin as SkillOrigin
  if (typeof origin.source !== 'string' || typeof origin.sourceType !== 'string') return null
  return {
    key: skillOriginKey(origin),
    name: item.name,
    origin,
    installName: item.installName,
    enabled: item.enabled !== false,
  }
}

export function normalizePreset(value: unknown, fallbackId?: string): Preset | null {
  if (typeof value !== 'object' || value === null) return null
  const preset = value as Record<string, unknown>
  if (typeof preset.name !== 'string' || !Array.isArray(preset.items)) return null
  const now = new Date().toISOString()
  const items = preset.items.map(normalizeItem).filter((item): item is PresetItem => Boolean(item))
  return {
    id: typeof preset.id === 'string' && preset.id ? preset.id : fallbackId ?? randomUUID(),
    name: preset.name.trim(),
    description: typeof preset.description === 'string' ? preset.description : undefined,
    createdAt: typeof preset.createdAt === 'string' ? preset.createdAt : now,
    updatedAt: now,
    createdFrom: typeof preset.createdFrom === 'string' ? preset.createdFrom : 'manual',
    defaultTarget: validTarget(preset.defaultTarget)
      ? preset.defaultTarget as Preset['defaultTarget']
      : { kind: 'global' },
    applyMode: preset.applyMode === 'exact' ? 'exact' : 'additive',
    installMode: preset.installMode === 'symlink' ? 'symlink' : 'copy',
    items,
    lastAppliedAt: typeof preset.lastAppliedAt === 'string' ? preset.lastAppliedAt : undefined,
    lastApplyTarget: validTarget(preset.lastApplyTarget) ? preset.lastApplyTarget as Preset['defaultTarget'] : undefined,
  }
}

export function readPresets(path: string): PresetsFile {
  const value = readJsonDocument<PresetsFile>(path, emptyPresets)
  if (!value || value.version !== 1 || typeof value.presets !== 'object' || value.presets === null) return emptyPresets()
  const presets: Record<string, Preset> = {}
  for (const [id, preset] of Object.entries(value.presets)) {
    const normalized = normalizePreset(preset, id)
    if (normalized) presets[normalized.id] = normalized
  }
  return { version: 1, presets }
}

export function writePresets(file: PresetsFile, path: string): PresetsFile {
  writeJsonDocument(path, file)
  return file
}

export function savePreset(file: PresetsFile, request: {
  id?: string
  name: string
  description?: string
  createdFrom?: string
  defaultTarget?: Preset['defaultTarget']
  applyMode?: Preset['applyMode']
  installMode?: Preset['installMode']
  items: PresetItem[]
}): Preset {
  const name = request.name.trim()
  if (!name) throw new Error('预设名称不能为空')
  if (name.length > 80) throw new Error('预设名称过长')
  const items = request.items.map(normalizeItem).filter((item): item is PresetItem => Boolean(item))
  if (items.length === 0) throw new Error('预设至少需要一个技能')
  if (items.length > 500) throw new Error('预设最多 500 个技能')
  const now = new Date().toISOString()
  const existing = request.id ? file.presets[request.id] : undefined
  const preset: Preset = {
    id: existing?.id ?? request.id ?? randomUUID(),
    name,
    description: request.description?.trim() || undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    createdFrom: request.createdFrom ?? existing?.createdFrom ?? 'manual',
    defaultTarget: request.defaultTarget ?? existing?.defaultTarget ?? { kind: 'global' },
    applyMode: request.applyMode ?? existing?.applyMode ?? 'additive',
    installMode: request.installMode ?? existing?.installMode ?? 'copy',
    items,
    lastAppliedAt: existing?.lastAppliedAt,
    lastApplyTarget: existing?.lastApplyTarget,
  }
  file.presets[preset.id] = preset
  return preset
}

export function deletePreset(file: PresetsFile, id: string): PresetsFile {
  if (!file.presets[id]) throw new Error('预设不存在')
  delete file.presets[id]
  return file
}

export function exportPresets(file: PresetsFile): string {
  return JSON.stringify(file, null, 2)
}

export function importPresets(file: PresetsFile, raw: string): PresetsFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    throw new Error('预设 JSON 无法解析')
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('预设 JSON 结构非法')
  const value = parsed as Partial<PresetsFile>
  if (value.version !== 1 || typeof value.presets !== 'object' || value.presets === null) {
    throw new Error('预设 JSON 版本或结构非法')
  }
  const entries = Object.entries(value.presets)
  if (entries.length > 500) throw new Error('一次最多导入 500 个预设')
  for (const [id, preset] of entries) {
    const normalized = normalizePreset(preset, id)
    if (!normalized) throw new Error(`预设 ${id} 结构非法`)
    file.presets[normalized.id] = normalized
  }
  return file
}
