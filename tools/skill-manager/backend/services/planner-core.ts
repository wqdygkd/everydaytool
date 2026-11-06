import type {
  ApplyPlanRequest,
  ApplyPlanResult,
  CheckUpdatesRequest,
  GlobalLockEntry,
  GlobalLockFile,
  PlanAction,
  PlanItem,
  ProjectLockEntry,
  ProjectLockFile,
  Scope,
  SkillManagerRecord,
  SkillManagerTrashRecord,
  SourceCatalog,
  SourceCatalogEntry,
  UndoPlanRequest,
  UndoPlanResult,
  UpdatePlan,
} from '../../../../shared/skill-manager.ts'
import type { TrashEntry } from './executor.ts'
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, rm } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { parseGlobalLock, readGlobalLock, writeGlobalLock } from '../locks/global-lock.ts'
import { parseProjectLock, readProjectLock, writeProjectLock } from '../locks/project-lock.ts'
import { resolveSource } from '../sources/catalog.ts'
import {
  commitStagedDirectory,
  createTrashSession,
  exists,
  fingerprint,
  InstallTransactionError,
  moveToTrash,
  removePath,
  restoreTrashEntry,
  writeTextAtomic,
} from './executor.ts'
import { appendSkillManagerHistory, markSkillManagerHistoryUndone, readSkillManagerHistory } from './history.ts'
import {
  originOf,
  safeHash,
  stageCatalog,
  validateStagedSkill,
} from './installer-core.ts'
import {
  readSkillManagerRegistry,
  upsertGroup,
  upsertRecord,
  writeSkillManagerRegistry,
} from './registry.ts'
import { scanScope } from './scanner.ts'

export interface PlanPaths {
  skillsDir: string
  lockPath: string
  trashRoot: string
  registryPath: string
  historyPath: string
  stagingRoot: string
  backupRoot: string
  projectPath?: string
  removePolicy?: 'trash' | 'keep'
}

interface PlanContext {
  plan: UpdatePlan
  scope: Scope
  paths: PlanPaths
  catalog: SourceCatalog
  lockRaw: string
  lockSkills: Record<string, GlobalLockEntry | ProjectLockEntry>
  lockData: GlobalLockFile | ProjectLockFile
  records: Record<string, SkillManagerRecord>
  origins: Map<string, SkillManagerRecord['origin']>
  createdAtMs: number
}

interface PreparedPlanItem {
  item: PlanItem
  entry: SourceCatalogEntry
  stagingDir: string
  contentHash: string
}

const plans = new Map<string, PlanContext>()
const PLAN_TTL_MS = 15 * 60 * 1000
const MAX_NAMES = 200
const ACTIONS: PlanAction[] = ['update', 'add', 'install', 'remove', 'move', 'reinstall', 'conflict', 'ambiguous', 'unknown', 'skip']

function emptySummary(): Record<PlanAction, number> {
  return Object.fromEntries(ACTIONS.map(action => [action, 0])) as Record<PlanAction, number>
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function planError(code: string, message: string): InstallTransactionError {
  return new InstallTransactionError(code, message)
}

function isGlobal(scope: Scope): boolean {
  return scope.kind === 'global'
}

async function readLock(scope: Scope, paths: PlanPaths): Promise<{ raw: string, skills: Record<string, GlobalLockEntry | ProjectLockEntry>, data: GlobalLockFile | ProjectLockFile }> {
  const result = isGlobal(scope) ? await readGlobalLock(paths.lockPath) : await readProjectLock(paths.projectPath ?? '')
  if (!result.ok) throw planError('lock-invalid', `锁文件不可用：${result.message}`)
  return { raw: result.raw, skills: result.data.skills as Record<string, GlobalLockEntry | ProjectLockEntry>, data: result.data }
}

function resolveCatalogInput(scope: Scope, paths: PlanPaths, source: string): string {
  if (scope.kind !== 'project' || isAbsolute(source)) return source
  return resolve(paths.projectPath ?? process.cwd(), source)
}

function lockFolderSha(scope: Scope, entry: GlobalLockEntry | ProjectLockEntry | undefined): string | undefined {
  if (!entry) return undefined
  if (scope.kind === 'project') return (entry as ProjectLockEntry).computedHash
  return (entry as GlobalLockEntry).skillFolderHash
}

function reasonFor(action: PlanAction): string[] {
  switch (action) {
    case 'remove': return ['上游已删除']
    case 'update': return ['上游内容有变化']
    case 'move': return ['上游路径已变化']
    case 'reinstall': return ['本地目录缺失，可重新安装']
    case 'ambiguous': return ['远端有多个同名技能，无法安全判断']
    case 'unknown': return ['无法确认远端状态，未生成删除动作']
    case 'conflict': return ['本地状态不允许自动处理']
    case 'add': return ['未加入本仓库选择']
    default: return []
  }
}

function findRemote(entries: SourceCatalogEntry[], name: string, fromPath?: string): { entry?: SourceCatalogEntry, ambiguous: boolean } {
  if (fromPath) {
    const exact = entries.find(entry => entry.skillPath === fromPath)
    if (exact) return { entry: exact, ambiguous: false }
  }
  const named = entries.filter(entry => entry.name === name)
  if (named.length === 1) return { entry: named[0], ambiguous: false }
  return { ambiguous: named.length > 1 }
}

/** 检查一个仓库组的更新；只读，不安装。网络/权限错误向上抛出，不生成删除项。 */
export async function createUpdatePlanCore(
  request: CheckUpdatesRequest,
  paths: PlanPaths,
): Promise<UpdatePlan> {
  const inventory = await scanScope(await scopeFor(request.scopeId, paths))
  const scope = inventory.scope
  const group = inventory.groups.find(item => item.key === request.groupKey)
  if (!group) throw planError('group-not-found', `找不到仓库组：${request.groupKey}`)
  if (group.orphan) throw planError('group-orphan', '未托管目录没有远端来源，无法检查更新')

  const lock = await readLock(scope, paths)
  const registry = readSkillManagerRegistry(paths.registryPath)
  const records = registry.scopes[scope.id]?.records ?? {}
  const catalog = await resolveSource(resolveCatalogInput(scope, paths, group.origin.source), group.origin.ref ?? undefined)
  const items: PlanItem[] = []
  const localNames = new Set<string>()

  for (const skill of group.skills) {
    localNames.add(skill.name)
    const lockEntry = lock.skills[skill.name]
    const record = records[skill.name]
    const fromPath = lockEntry?.skillPath ?? skill.skillPath
    const localHash = await safeHash(join(paths.skillsDir, skill.name))
    const localModified = Boolean(record?.baseline.contentHash && localHash && record.baseline.contentHash !== localHash)
    const reasons: string[] = []

    if (skill.lockManaged === false || record?.lockManaged === false) {
      items.push({
        name: skill.name,
        action: 'skip',
        fromPath,
        fromFolderSha: record?.remote.folderSha,
        localModified,
        selectedByDefault: false,
        reasons: ['本地接管：不写锁，不参与远端更新'],
      })
      continue
    }
    if (skill.installMode === 'symlink') {
      items.push({
        name: skill.name,
        action: 'conflict',
        fromPath,
        fromFolderSha: record?.remote.folderSha ?? lockFolderSha(scope, lockEntry),
        localModified,
        selectedByDefault: false,
        reasons: ['目标是符号链接，更新计划不会覆盖它'],
      })
      continue
    }
    if (skill.state === 'invalid') {
      items.push({
        name: skill.name,
        action: 'conflict',
        fromPath,
        fromFolderSha: record?.remote.folderSha ?? lockFolderSha(scope, lockEntry),
        localModified,
        selectedByDefault: false,
        reasons: ['本地 SKILL.md 无效，先修复后再更新'],
      })
      continue
    }

    const match = findRemote(catalog.entries, skill.name, fromPath)
    if (!match.entry) {
      if (match.ambiguous) {
        items.push({
          name: skill.name,
          action: 'ambiguous',
          fromPath,
          localModified,
          selectedByDefault: false,
          reasons: reasonFor('ambiguous'),
        })
      }
      else {
        items.push({
          name: skill.name,
          action: 'remove',
          fromPath,
          fromFolderSha: record?.remote.folderSha ?? lockFolderSha(scope, lockEntry),
          localModified,
          selectedByDefault: !localModified,
          reasons: reasonFor('remove'),
        })
      }
      continue
    }

    const fromSha = record?.remote.folderSha ?? lockFolderSha(scope, lockEntry)
    const samePath = Boolean(fromPath && match.entry.skillPath === fromPath)
    let action: PlanAction = 'skip'
    if (!skill.tracked) action = 'skip'
    else if (skill.state === 'missing') action = 'reinstall'
    else if (!samePath) action = 'move'
    else if (fromSha && match.entry.folderSha && fromSha !== match.entry.folderSha) action = 'update'
    else if (localModified) action = 'update'
    else action = 'skip'

    if (action !== 'skip') reasons.push(...reasonFor(action))
    if (localModified) reasons.push('本地内容与安装基线不同，默认不勾选')
    if (action === 'update' && !match.entry.folderSha) reasons.push('缺少远端 folderSha，按本地修改判断')
    items.push({
      name: skill.name,
      action,
      fromPath,
      toPath: match.entry.skillPath,
      fromFolderSha: fromSha,
      toFolderSha: match.entry.folderSha,
      localModified,
      selectedByDefault: action !== 'skip' && !localModified,
      reasons: unique(reasons),
    })
  }

  for (const entry of catalog.entries) {
    if (localNames.has(entry.name)) continue
    items.push({
      name: entry.name,
      action: 'add',
      toPath: entry.skillPath,
      toFolderSha: entry.folderSha,
      localModified: false,
      selectedByDefault: false,
      reasons: reasonFor('add'),
    })
  }

  const summary = emptySummary()
  for (const item of items) summary[item.action] += 1

  const plan: UpdatePlan = {
    id: `plan_${Date.now()}_${randomBytes(4).toString('hex')}`,
    kind: 'update',
    scopeId: scope.id,
    groupKey: group.key,
    createdAt: new Date().toISOString(),
    resolvedRef: catalog.resolvedRef,
    commitSha: catalog.commitSha,
    items,
    summary,
    warnings: catalog.warnings,
  }

  plans.set(plan.id, {
    plan,
    scope,
    paths,
    catalog,
    lockRaw: lock.raw,
    lockSkills: lock.skills,
    lockData: lock.data,
    records,
    origins: new Map(),
    createdAtMs: Date.now(),
  })
  return plan
}

/** 重新构造当前 scope；scan 只接受真实路径，scope 必须与当前项目/全局一致。 */
async function scopeFor(scopeId: string, paths: PlanPaths): Promise<Scope> {
  if (scopeId === 'global') {
    return {
      id: 'global',
      kind: 'global',
      label: '全局',
      skillsDir: paths.skillsDir,
      lockPath: paths.lockPath,
      lockState: 'missing',
    }
  }
  if (!scopeId.startsWith('project:') || !paths.projectPath) {
    throw planError('scope-not-found', `找不到 scope：${scopeId}`)
  }
  return {
    id: scopeId,
    kind: 'project',
    label: paths.projectPath.split('/').pop() || paths.projectPath,
    skillsDir: paths.skillsDir,
    lockPath: paths.lockPath,
    projectPath: paths.projectPath,
    lockState: 'missing',
  }
}

function getContext(planId: string): PlanContext {
  const context = plans.get(planId)
  if (!context) throw planError('plan-not-found', '计划不存在或服务已重启，请重新检查更新')
  if (Date.now() - context.createdAtMs > PLAN_TTL_MS) {
    plans.delete(planId)
    throw planError('plan-expired', '计划已过期，请重新检查更新')
  }
  return context
}

function findAllRemote(catalog: SourceCatalog, item: PlanItem): SourceCatalogEntry {
  const exact = item.toPath ? catalog.entries.find(entry => entry.skillPath === item.toPath) : undefined
  if (exact) return exact
  const named = catalog.entries.filter(entry => entry.name === item.name)
  if (named.length === 1) return named[0]
  throw planError('skill-not-found', `来源中找不到技能：${item.name}`)
}

/** 应用计划；只处理 names 中明确选中的 update/move/reinstall/remove。 */
export async function applyUpdatePlanCore(
  request: ApplyPlanRequest,
  paths?: PlanPaths,
): Promise<ApplyPlanResult> {
  const context = getContext(request.planId)
  if (paths && paths.projectPath !== context.paths.projectPath) throw planError('scope-mismatch', '计划 scope 不一致')
  const plan = context.plan
  const requested = unique(Array.isArray(request.names) ? request.names : [])
  if (requested.length === 0) throw planError('empty-selection', '至少选择一个动作')
  if (requested.length > MAX_NAMES) throw planError('too-many-names', `一次最多处理 ${MAX_NAMES} 个技能`)

  const selected = plan.items.filter(item => requested.includes(item.name))
  const updates = selected.filter(item => item.action === 'update' || item.action === 'move' || item.action === 'reinstall')
  const removals = selected.filter(item => item.action === 'remove')
  const skipped = requested.filter(name => !updates.some(item => item.name === name) && !removals.some(item => item.name === name))
  if (updates.length === 0 && removals.length === 0) throw planError('no-actionable', '选中的技能没有可执行动作')

  const lock = await readLock(context.scope, context.paths)
  if (lock.raw !== context.lockRaw) throw planError('lock-changed', '锁文件已被其他工具修改，请刷新后重试')

  const sourceInput = resolveCatalogInput(context.scope, context.paths, context.catalog.source)
  const fresh = await resolveSource(sourceInput, context.catalog.ref ?? undefined)
  if (plan.commitSha && fresh.commitSha && plan.commitSha !== fresh.commitSha) {
    throw planError('source-changed', '远端在检查后已经变化，请重新检查更新')
  }

  const stagingRoot = join(context.paths.stagingRoot, `plan_${Date.now()}_${randomBytes(3).toString('hex')}`)
  const operationId = `smplan_${Date.now()}_${randomBytes(4).toString('hex')}`
  const staged = new Map<string, string>()
  const prepared: PreparedPlanItem[] = []
  const warnings = [...fresh.warnings]
  const session = createTrashSession(context.paths.trashRoot, operationId, context.scope.id, 'update-plan')
  const changed: Array<{ name: string, target: string, trashed?: TrashEntry, added: boolean }> = []

  try {
    await mkdir(stagingRoot, { recursive: true })
    if (updates.length > 0) await stageCatalog(fresh, updates.map(item => item.name), stagingRoot, staged)
    for (const item of updates) {
      const entry = findAllRemote(fresh, item)
      if (item.toFolderSha && entry.folderSha && item.toFolderSha !== entry.folderSha) {
        throw planError('source-changed', `远端技能已变化：${item.name}，请重新检查更新`)
      }
      const stagingDir = staged.get(item.name)
      if (!stagingDir) throw planError('staging-missing', `未生成暂存目录：${item.name}`)
      const contentHash = await validateStagedSkill(stagingDir, item.name, entry, warnings)
      prepared.push({ item, entry, stagingDir, contentHash })
    }

    for (const item of removals) {
      const target = join(context.paths.skillsDir, item.name)
      if (!await exists(target)) continue
      if (context.paths.removePolicy === 'keep') {
        changed.push({ name: item.name, target, added: false })
        continue
      }
      const trashed = await moveToTrash(session, target, item.name, undefined, await safeHash(target))
      changed.push({ name: item.name, target, trashed, added: false })
    }

    for (const preparedItem of prepared) {
      const { entry, stagingDir } = preparedItem
      const name = preparedItem.item.name
      const target = join(context.paths.skillsDir, name)
      const info = await lstat(target).catch(() => null)
      if (info?.isSymbolicLink()) throw planError('unsafe-symlink', `目标是符号链接，拒绝覆盖：${name}`)
      let trashed: TrashEntry | undefined
      if (await exists(target)) trashed = await moveToTrash(session, target, name, originOf(fresh, entry), await safeHash(target))
      try {
        await commitStagedDirectory(stagingDir, context.paths.skillsDir, name, operationId)
      }
      catch (error) {
        if (trashed) await restoreTrashEntry(trashed).catch(() => {})
        throw error
      }
      changed.push({ name, target, trashed, added: true })
    }

    const beforeWrite = await readLock(context.scope, context.paths)
    if (beforeWrite.raw !== context.lockRaw) throw planError('lock-changed', '锁文件在应用计划时被修改，已回滚')

    const now = new Date().toISOString()
    const nextLock = buildNextLock(context, prepared, removals, now)
    const lockRaw = context.scope.kind === 'global'
      ? await writeGlobalLock(nextLock as GlobalLockFile, context.paths.lockPath)
      : (await writeProjectLock(nextLock as ProjectLockFile, context.paths.projectPath!, {
          operationId,
          backupRoot: context.paths.backupRoot,
          expectedRaw: context.lockRaw,
        })).raw
    const nextFingerprint = fingerprint(lockRaw)

    const updatedNames = prepared.map(item => item.item.name)
    const removedNames = removals.map(item => item.name)
    const historyId = `hist_${operationId}`
    const trashEntries: SkillManagerTrashRecord[] = session.entries.map(entry => ({
      name: entry.name,
      sourcePath: entry.sourcePath,
      trashPath: entry.trashPath,
    }))
    const trashRef = trashEntries.length > 0 ? session.id : undefined

    try {
      writeRegistryAfterPlan(context, prepared, removals, fresh, nextLock, nextFingerprint, now, trashRef)
    }
    catch (error) {
      warnings.push(`registry 写入失败：${(error as Error).message}`)
    }
    try {
      appendSkillManagerHistory({
        id: historyId,
        at: now,
        action: removedNames.length > 0 && updatedNames.length === 0 ? 'uninstall' : 'update',
        scopeId: context.scope.id,
        operationId,
        names: [...updatedNames, ...removedNames],
        status: 'ok',
        planId: plan.id,
        groupKey: plan.groupKey,
        beforeLockRaw: context.lockRaw,
        afterLockFingerprint: nextFingerprint,
        trashRef,
        trashEntries,
        updatedNames,
        removedNames,
        detail: `plan ${plan.id}`,
      }, context.paths.historyPath)
    }
    catch (error) {
      warnings.push(`history 写入失败：${(error as Error).message}`)
    }

    return {
      operationId,
      planId: plan.id,
      applied: [...updatedNames, ...removedNames],
      updated: updatedNames,
      removed: removedNames,
      skipped,
      lockPath: context.paths.lockPath,
      trashRef,
      historyId,
      warnings,
    }
  }
  catch (error) {
    for (const entry of [...changed].reverse()) {
      if (entry.added) await removePath(entry.target).catch(() => {})
      if (entry.trashed) await restoreTrashEntry(entry.trashed).catch(() => {})
    }
    throw error
  }
  finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {})
  }
}

function buildNextLock(
  context: PlanContext,
  prepared: PreparedPlanItem[],
  removals: PlanItem[],
  now: string,
): GlobalLockFile | ProjectLockFile {
  const next = { ...context.lockSkills }
  for (const item of removals) delete next[item.name]
  for (const { item, entry, contentHash } of prepared) {
    const previous = next[item.name]
    if (context.scope.kind === 'global') {
      const globalEntry: GlobalLockEntry = {
        ...(previous as GlobalLockEntry | undefined),
        source: context.catalog.source,
        sourceType: context.catalog.sourceType,
        skillPath: entry.skillPath,
        skillFolderHash: entry.folderSha ?? contentHash,
        installedAt: (previous as GlobalLockEntry | undefined)?.installedAt ?? now,
        updatedAt: now,
        installMode: 'copy',
      }
      if (context.catalog.sourceUrl) globalEntry.sourceUrl = context.catalog.sourceUrl
      else delete globalEntry.sourceUrl
      if (context.catalog.ref) globalEntry.ref = context.catalog.ref
      else delete globalEntry.ref
      next[item.name] = globalEntry
    }
    else {
      const projectEntry: ProjectLockEntry = {
        ...(previous as ProjectLockEntry | undefined),
        source: (previous as ProjectLockEntry | undefined)?.source ?? context.catalog.source,
        sourceType: (previous as ProjectLockEntry | undefined)?.sourceType ?? context.catalog.sourceType,
        skillPath: entry.skillPath,
        computedHash: contentHash,
      }
      if (context.catalog.sourceUrl) projectEntry.sourceUrl = context.catalog.sourceUrl
      else delete projectEntry.sourceUrl
      if (context.catalog.ref) projectEntry.ref = context.catalog.ref
      else delete projectEntry.ref
      next[item.name] = projectEntry
    }
  }
  if (context.scope.kind === 'global') {
    return { ...(context.lockData as GlobalLockFile), version: 3, skills: next as Record<string, GlobalLockEntry> }
  }
  return { ...(context.lockData as ProjectLockFile), version: 1, skills: next as Record<string, ProjectLockEntry> }
}

function writeRegistryAfterPlan(
  context: PlanContext,
  prepared: PreparedPlanItem[],
  removals: PlanItem[],
  catalog: SourceCatalog,
  nextLock: GlobalLockFile | ProjectLockFile,
  lockFingerprint: string,
  now: string,
  trashRef: string | undefined,
): void {
  const registry = readSkillManagerRegistry(context.paths.registryPath)
  const scope = registry.scopes[context.scope.id] ?? { records: {} }
  registry.scopes[context.scope.id] = scope
  scope.lockFingerprint = lockFingerprint
  scope.lastScanAt = now

  for (const { item, entry, contentHash } of prepared) {
    const previous = scope.records[item.name]
    const record: SkillManagerRecord = {
      name: item.name,
      dirName: item.name,
      origin: originOf(catalog, entry),
      installMode: 'copy',
      baseline: { contentHash, capturedAt: now, source: 'install' },
      remote: { folderSha: entry.folderSha, resolvedRef: catalog.resolvedRef, commitSha: catalog.commitSha, fetchedAt: now },
      tracked: true,
      forked: false,
      state: 'installed',
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
      removedAt: null,
      removedReason: null,
      trashRef: null,
    }
    upsertRecord(registry, context.scope.id, item.name, record)
  }

  for (const item of removals) {
    const previous = scope.records[item.name]
    const record: SkillManagerRecord = {
      name: item.name,
      dirName: item.name,
      origin: previous?.origin ?? {
        sourceType: context.catalog.sourceType,
        source: context.catalog.source,
        ref: context.catalog.ref ?? undefined,
      },
      installMode: previous?.installMode ?? 'copy',
      baseline: previous?.baseline ?? { contentHash: item.fromFolderSha ?? '', capturedAt: now, source: 'install' },
      remote: previous?.remote ?? { fetchedAt: now },
      tracked: false,
      forked: previous?.forked ?? false,
      state: 'removed',
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
      removedAt: now,
      removedReason: 'removed-upstream',
      trashRef: trashRef ?? null,
    }
    upsertRecord(registry, context.scope.id, item.name, record)
  }

  const groupKey = `${context.scope.id}|${context.plan.groupKey}`
  const selectedNames = Object.keys(nextLock.skills).sort()
  upsertGroup(registry, groupKey, {
    selectedNames,
    installedNames: selectedNames,
    lastFetchedNames: catalog.entries.map(entry => entry.name),
    lastFetchedAt: now,
    resolvedRef: catalog.resolvedRef,
    commitSha: catalog.commitSha,
    lastPlanId: context.plan.id,
    lastPlanSummary: context.plan.summary,
  })
  writeSkillManagerRegistry(registry, context.paths.registryPath)
}

/** 撤销一条计划历史：先移除本次更新的新目录，再从回收站恢复旧目录/锁。 */
export async function undoPlanCore(
  request: UndoPlanRequest,
  paths: PlanPaths,
): Promise<UndoPlanResult> {
  if (request.scopeId.startsWith('project:') && !paths.projectPath) throw planError('project-missing', '项目路径缺失')
  const history = readSkillManagerHistory(paths.historyPath)
  const entry = request.historyId
    ? history.entries.find(item => item.id === request.historyId)
    : history.entries.find(item => item.planId && !item.undoneAt && item.scopeId === request.scopeId)
  if (!entry) throw planError('history-not-found', '找不到可撤销的计划历史')
  if (entry.scopeId !== request.scopeId) throw planError('scope-mismatch', '历史 scope 不一致')
  if (entry.undoneAt) throw planError('already-undone', '这次计划已经撤销过')
  if (!entry.beforeLockRaw || !entry.trashEntries) throw planError('history-incomplete', '这次历史缺少可撤销快照')

  const scope: Scope = request.scopeId === 'global'
    ? { id: 'global', kind: 'global', label: '全局', skillsDir: paths.skillsDir, lockPath: paths.lockPath, lockState: 'missing' }
    : {
        id: request.scopeId,
        kind: 'project',
        label: paths.projectPath!.split('/').pop() || paths.projectPath!,
        skillsDir: paths.skillsDir,
        lockPath: paths.lockPath,
        projectPath: paths.projectPath,
        lockState: 'missing',
      }
  const current = await readLock(scope, paths)
  if (entry.afterLockFingerprint && fingerprint(current.raw) !== entry.afterLockFingerprint) {
    throw planError('lock-changed', '锁文件在应用计划后又被修改，不能撤销')
  }

  const updatedNames = new Set(entry.updatedNames ?? [])
  const removedNames = new Set(entry.removedNames ?? [])
  const entries = entry.trashEntries
  for (const item of entries) {
    if (!updatedNames.has(item.name) && !removedNames.has(item.name)) continue
    if (!updatedNames.has(item.name) && await exists(item.sourcePath)) {
      throw planError('undo-conflict', `恢复目标已存在：${item.sourcePath}`)
    }
  }

  const warnings: string[] = []
  for (const item of entries) {
    if (updatedNames.has(item.name)) await removePath(item.sourcePath).catch(() => {})
  }
  for (const item of entries) {
    try {
      await restoreTrashEntry({ name: item.name, sourcePath: item.sourcePath, trashPath: item.trashPath })
    }
    catch (error) {
      warnings.push(`恢复失败 ${item.name}：${(error as Error).message}`)
    }
  }

  const oldRaw = entry.beforeLockRaw
  const oldLock = scope.kind === 'global'
    ? parseGlobalLock(oldRaw, paths.lockPath)
    : parseProjectLock(oldRaw, paths.lockPath)
  if (!oldLock.ok) throw planError('history-lock-invalid', `历史锁无法解析：${oldLock.message}`)
  await writeTextAtomic(paths.lockPath, oldRaw)

  const registry = readSkillManagerRegistry(paths.registryPath)
  const scopeRegistry = registry.scopes[scope.id] ?? { records: {} }
  registry.scopes[scope.id] = scopeRegistry
  const now = new Date().toISOString()
  for (const name of [...updatedNames, ...removedNames]) {
    const lockEntry = oldLock.data.skills[name]
    if (!lockEntry) continue
    const hash = await safeHash(join(paths.skillsDir, name))
    const previous = scopeRegistry.records[name]
    if (!hash) continue
    upsertRecord(registry, scope.id, name, {
      ...(previous ?? {
        name,
        dirName: name,
        origin: {
          sourceType: scope.kind === 'global' ? 'github' : 'local',
          source: (lockEntry as ProjectLockEntry).source ?? '',
        },
        installMode: 'copy',
        remote: { fetchedAt: now },
        forked: false,
        installedAt: now,
      }),
      tracked: true,
      state: 'installed',
      baseline: { contentHash: hash, capturedAt: now, source: 'repair' },
      updatedAt: now,
      removedAt: null,
      removedReason: null,
      trashRef: null,
    } as SkillManagerRecord)
  }
  const groupKey = entry.groupKey ?? `${scope.id}|unknown`
  const names = Object.keys(oldLock.data.skills).sort()
  upsertGroup(registry, groupKey, {
    selectedNames: names,
    installedNames: names,
    disabledNames: [],
    lastFetchedAt: now,
  })
  scopeRegistry.lockFingerprint = fingerprint(oldRaw)
  writeSkillManagerRegistry(registry, paths.registryPath)
  markSkillManagerHistoryUndone(entry.id, paths.historyPath)

  return { historyId: entry.id, restored: entries.map(item => item.name), lockPath: paths.lockPath, warnings }
}

/** 测试/服务重启时清空内存计划。 */
export function clearUpdatePlans(): void {
  plans.clear()
}
