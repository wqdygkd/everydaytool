import type {
  InstallResult,
  Preset,
  PresetApplyItem,
  PresetApplyRequest,
  PresetApplyResult,
  PresetItem,
  ProjectLockFile,
} from '../../../../shared/skill-manager.ts'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { readGlobalLock, writeGlobalLock } from '../locks/global-lock.ts'
import { readProjectLock, writeProjectLock } from '../locks/project-lock.ts'
import { createTrashSession, moveToTrash } from './executor.ts'
import { installSkillsCore } from './installer-core.ts'
import { installSkillsToProject } from './project-installer.ts'
import { readSkillManagerRegistry, writeSkillManagerRegistry } from './registry.ts'

export interface PresetApplyPaths {
  kind: 'global' | 'project' | 'custom'
  scopeId: string
  skillsDir: string
  lockPath: string
  registryPath: string
  historyPath: string
  trashRoot: string
  stagingRoot: string
  backupRoot: string
  projectPath?: string
  removePolicy?: 'trash' | 'keep'
}

interface ItemGroup {
  input: string
  ref?: string
  items: PresetItem[]
}

function groupItems(items: PresetItem[]): ItemGroup[] {
  const groups = new Map<string, ItemGroup>()
  for (const item of items) {
    const signature = `${item.origin.sourceType}|${item.origin.source}|${item.origin.ref ?? ''}`
    const group = groups.get(signature) ?? {
      input: item.origin.source,
      ref: item.origin.ref ?? undefined,
      items: [],
    }
    group.items.push(item)
    groups.set(signature, group)
  }
  return [...groups.values()]
}

function mark(items: PresetApplyItem[], keys: string[], action: PresetApplyItem['action'], message?: string): void {
  const wanted = new Set(keys)
  for (const item of items) {
    if (wanted.has(item.key)) {
      item.action = action
      if (message) item.message = message
    }
  }
}

async function installGroup(
  group: ItemGroup,
  paths: PresetApplyPaths,
): Promise<InstallResult> {
  const names = [...new Set(group.items.map(item => item.installName))]
  if (paths.kind === 'global') {
    return installSkillsCore({
      input: group.input,
      ref: group.ref,
      names,
      scopeId: 'global',
    }, paths)
  }
  if (!paths.projectPath) throw new Error('项目安装缺少项目路径')
  return installSkillsToProject({
    input: group.input,
    ref: group.ref,
    names,
    scopeId: paths.scopeId,
    projectPath: paths.projectPath,
  }, {
    projectPath: paths.projectPath,
    skillsDir: paths.skillsDir,
    lockPath: paths.lockPath,
    trashRoot: paths.trashRoot,
    registryPath: paths.registryPath,
    historyPath: paths.historyPath,
    stagingRoot: paths.stagingRoot,
    backupRoot: paths.backupRoot,
  })
}

async function removeExtras(
  desired: Set<string>,
  paths: PresetApplyPaths,
  operationId: string,
  removed: string[],
  warnings: string[],
): Promise<void> {
  if (paths.kind === 'global') {
    const lock = await readGlobalLock(paths.lockPath)
    if (!lock.ok) throw new Error(`全局锁不可用：${lock.message}`)
    const extras = Object.keys(lock.data.skills).filter(name => !desired.has(name))
    if (extras.length === 0) return
    if (paths.removePolicy !== 'keep') {
      const session = await createTrashSession(paths.trashRoot, operationId, paths.scopeId, 'preset-exact')
      for (const name of extras) {
        const target = join(paths.skillsDir, name)
        await moveToTrash(session, target, name)
      }
    }
    for (const name of extras) delete lock.data.skills[name]
    await writeGlobalLock(lock.data, paths.lockPath)
    removed.push(...extras)
    warnings.push(paths.removePolicy === 'keep'
      ? `exact 模式停止跟踪 ${extras.length} 个预设外技能，目录按保留策略留在原处`
      : `exact 模式移除了 ${extras.length} 个预设外技能`)
    return
  }

  if (!paths.projectPath) return
  const lock = await readProjectLock(paths.projectPath)
  if (!lock.ok) throw new Error(`项目锁不可用：${lock.message}`)
  const extras = Object.keys(lock.data.skills).filter(name => !desired.has(name))
  if (extras.length === 0) return
  if (paths.removePolicy !== 'keep') {
    const session = await createTrashSession(paths.trashRoot, operationId, paths.scopeId, 'preset-exact')
    for (const name of extras) {
      await moveToTrash(session, join(paths.skillsDir, name), name)
    }
  }
  for (const name of extras) delete lock.data.skills[name]
  await writeProjectLock(lock.data as ProjectLockFile, paths.projectPath, {
    operationId,
    backupRoot: paths.backupRoot,
    expectedRaw: lock.raw,
  })
  removed.push(...extras)
  warnings.push(paths.removePolicy === 'keep'
    ? `exact 模式停止跟踪 ${extras.length} 个预设外技能，目录按保留策略留在原处`
    : `exact 模式移除了 ${extras.length} 个预设外技能`)
}

function updateRegistryAfterExact(scopeId: string, removed: string[], paths: PresetApplyPaths): void {
  if (removed.length === 0) return
  const registry = readSkillManagerRegistry(paths.registryPath)
  const scope = registry.scopes[scopeId]
  for (const name of removed) {
    if (scope) delete scope.records[name]
    for (const group of Object.values(registry.groups)) {
      group.selectedNames = group.selectedNames.filter(item => item !== name)
      group.installedNames = group.installedNames.filter(item => item !== name)
      group.disabledNames = group.disabledNames.filter(item => item !== name)
    }
  }
  writeSkillManagerRegistry(registry, paths.registryPath)
}

export async function applyPresetCore(
  request: PresetApplyRequest,
  preset: Preset,
  paths: PresetApplyPaths,
): Promise<PresetApplyResult> {
  if (paths.kind === 'custom' && request.target.asSkillsRoot) {
    throw new Error('自定义目录直接作为技能根（asSkillsRoot）暂未开放')
  }
  const role = request.mode ?? preset.applyMode ?? 'additive'
  const selected = request.selectedKeys ? new Set(request.selectedKeys) : undefined
  const items = preset.items.filter(item => item.enabled && (!selected || selected.has(item.key)))
  if (items.length === 0) throw new Error('预设没有可应用的技能')
  const operationId = `smpreset_${Date.now()}_${randomBytes(4).toString('hex')}`
  const result: PresetApplyResult = {
    operationId,
    presetId: preset.id,
    target: request.target,
    mode: role,
    status: 'ok',
    installed: [],
    updated: [],
    removed: [],
    skipped: [],
    unavailable: [],
    conflicts: [],
    warnings: [],
    items: items.map(item => ({ key: item.key, name: item.installName, action: 'skip' })),
  }

  for (const group of groupItems(items)) {
    try {
      const installed = await installGroup(group, paths)
      result.installed.push(...installed.installed)
      result.updated.push(...installed.updated)
      result.conflicts.push(...installed.conflicts)
      result.warnings.push(...installed.warnings)
      mark(result.items, group.items.filter(item => installed.installed.includes(item.installName)).map(item => item.key), 'install')
      mark(result.items, group.items.filter(item => installed.updated.includes(item.installName)).map(item => item.key), 'update')
      const conflictNames = new Set(installed.conflicts.map(conflict => conflict.name))
      for (const item of group.items) {
        const entry = result.items.find(candidate => candidate.key === item.key)
        if (!entry) continue
        if (conflictNames.has(item.installName)) entry.action = 'conflict'
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.unavailable.push(...group.items.map(item => item.installName))
      mark(result.items, group.items.map(item => item.key), 'unavailable', message)
      result.warnings.push(`${group.input}: ${message}`)
    }
  }

  const desired = new Set(items.map(item => item.installName))
  if (role === 'exact') {
    try {
      await removeExtras(desired, paths, operationId, result.removed, result.warnings)
      updateRegistryAfterExact(paths.scopeId, result.removed, paths)
      for (const name of result.removed) {
        const entry = result.items.find(item => item.name === name)
        if (entry) entry.action = 'remove'
      }
    }
    catch (error) {
      result.warnings.push(error instanceof Error ? error.message : String(error))
    }
  }

  const changed = result.installed.length + result.updated.length + result.removed.length
  if (result.unavailable.length > 0 || result.conflicts.length > 0) result.status = changed > 0 ? 'partial' : 'conflict'
  return result
}
