import type {
  AdoptRequest,
  AdoptResult,
  GlobalLockEntry,
  ProjectLockEntry,
  Scope,
  SkillManagerHistoryEntry,
  SkillManagerRecord,
  SkillOrigin,
  SourceCatalog,
  SourceCatalogEntry,
} from '../../../../shared/skill-manager.ts'
import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { readGlobalLock, writeGlobalLock } from '../locks/global-lock.ts'
import { readProjectLock, writeProjectLock } from '../locks/project-lock.ts'
import { resolveSource } from '../sources/catalog.ts'
import { removePath, writeTextAtomic } from './executor.ts'
import { hashSkillDirectory } from './hash.ts'
import { appendSkillManagerHistory } from './history.ts'
import { originKeyOf } from './installer-core.ts'
import { readSkillManagerRegistry, upsertGroup, upsertRecord, writeSkillManagerRegistry } from './registry.ts'

export interface AdoptPaths {
  registryPath: string
  historyPath: string
  backupRoot: string
}

export class AdoptError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function projectSource(catalog: SourceCatalog, projectPath: string): string {
  if (catalog.sourceType !== 'local' || !isAbsolute(catalog.source)) return catalog.source
  const relativePath = relative(projectPath, catalog.source)
  if (!relativePath || isAbsolute(relativePath)) return catalog.source
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`
}

function sourceOrigin(catalog: SourceCatalog, entry: SourceCatalogEntry): SkillOrigin {
  return {
    sourceType: catalog.sourceType,
    source: catalog.source,
    sourceUrl: catalog.sourceUrl,
    ref: catalog.ref ?? null,
    skillPath: entry.skillPath,
  }
}

async function findEntry(
  catalog: SourceCatalog,
  request: AdoptRequest,
): Promise<SourceCatalogEntry> {
  const exactPath = request.skillPath
    ? catalog.entries.find(entry => entry.skillPath === request.skillPath)
    : undefined
  if (exactPath) return exactPath
  const byName = catalog.entries.filter(entry => entry.name === request.name)
  if (byName.length === 1) return byName[0]!
  if (byName.length > 1) {
    throw new AdoptError('ambiguous-source', `来源中有多个名为 ${request.name} 的技能，请指定 skillPath`)
  }
  if (!request.skillPath && catalog.entries.length === 1) return catalog.entries[0]!
  throw new AdoptError('skill-not-found', `来源中找不到 ${request.name}${request.skillPath ? `（${request.skillPath}）` : ''}`)
}

export async function adoptSkillCore(
  request: AdoptRequest,
  scope: Scope,
  paths: AdoptPaths,
): Promise<AdoptResult> {
  if (!request.name || request.name.includes('/') || request.name.includes('\\') || request.name === '.' || request.name === '..') {
    throw new AdoptError('invalid-name', `技能名不合法：${request.name}`)
  }
  const targetPath = join(scope.skillsDir, request.name)
  let targetStat
  try {
    targetStat = await lstat(targetPath)
  }
  catch {
    throw new AdoptError('not-found', `未找到未托管技能：${request.name}`)
  }
  if (!targetStat.isDirectory() && !targetStat.isSymbolicLink()) {
    throw new AdoptError('not-directory', `目标不是技能目录：${request.name}`)
  }

  const now = new Date().toISOString()
  const operationId = randomUUID()
  const installMode = targetStat.isSymbolicLink() ? 'symlink' : 'copy'
  const contentHash = await hashSkillDirectory(targetPath)
  const registry = readSkillManagerRegistry(paths.registryPath)
  const previousRecord = registry.scopes[scope.id]?.records[request.name]
  const oldRaw = scope.kind === 'project'
    ? (await readProjectLock(scope.projectPath ?? '')).raw
    : (await readGlobalLock(scope.lockPath)).raw

  let catalog: SourceCatalog | undefined
  let entry: SourceCatalogEntry | undefined
  let origin: SkillOrigin
  let lockManaged = false
  let lockPath: string | undefined

  if (request.mode === 'source') {
    if (!request.input) throw new AdoptError('missing-source', '绑定来源需要填写来源')
    catalog = await resolveSource(request.input, request.ref)
    entry = await findEntry(catalog, request)
    origin = sourceOrigin(catalog, entry)
    lockManaged = true
  }
  else {
    origin = {
      sourceType: 'local',
      source: targetPath,
      ref: null,
      skillPath: 'SKILL.md',
    }
  }

  if (request.mode === 'source') {
    if (!catalog || !entry) throw new AdoptError('source-unavailable', '来源不可用')
    if (scope.kind === 'project') {
      if (!scope.projectPath) throw new AdoptError('project-missing', '项目路径不可用')
      const lock = await readProjectLock(scope.projectPath)
      if (!lock.ok) throw new AdoptError('lock-invalid', lock.message)
      if (lock.data.skills[request.name]) {
        throw new AdoptError('already-tracked', `${request.name} 已在项目锁中`)
      }
      const lockEntry: ProjectLockEntry = {
        source: projectSource(catalog, scope.projectPath),
        sourceType: catalog.sourceType,
        skillPath: entry.skillPath,
        computedHash: entry.folderSha ?? contentHash,
      }
      if (catalog.sourceType === 'git') lockEntry.sourceUrl = catalog.sourceUrl ?? catalog.source
      if (catalog.ref) lockEntry.ref = catalog.ref
      const next = { ...lock.data, version: 1 as const, skills: { ...lock.data.skills, [request.name]: lockEntry } }
      const written = await writeProjectLock(next, scope.projectPath, {
        operationId,
        backupRoot: paths.backupRoot,
        expectedRaw: lock.raw || undefined,
      })
      lockPath = written.path
    }
    else {
      const lock = await readGlobalLock(scope.lockPath)
      if (!lock.ok) throw new AdoptError('lock-invalid', lock.message)
      if (lock.data.skills[request.name]) {
        throw new AdoptError('already-tracked', `${request.name} 已在全局锁中`)
      }
      const lockEntry: GlobalLockEntry = {
        source: catalog.source,
        sourceType: catalog.sourceType,
        skillPath: entry.skillPath,
        skillFolderHash: entry.folderSha ?? contentHash,
        installedAt: previousRecord?.installedAt ?? now,
        updatedAt: now,
      }
      if (catalog.sourceType === 'git') lockEntry.sourceUrl = catalog.sourceUrl ?? catalog.source
      if (catalog.ref) lockEntry.ref = catalog.ref
      const next = { ...lock.data, version: 3, skills: { ...lock.data.skills, [request.name]: lockEntry } }
      await writeGlobalLock(next, scope.lockPath)
      lockPath = scope.lockPath
    }
  }

  const record: SkillManagerRecord = {
    name: request.name,
    dirName: request.name,
    origin,
    installMode,
    baseline: { contentHash, capturedAt: now, source: 'adopt' },
    remote: {
      folderSha: entry?.folderSha,
      resolvedRef: catalog?.resolvedRef,
      commitSha: catalog?.commitSha,
      fetchedAt: now,
    },
    tracked: true,
    forked: false,
    lockManaged,
    state: 'installed',
    installedAt: previousRecord?.installedAt ?? now,
    updatedAt: now,
    removedAt: null,
    removedReason: null,
    trashRef: previousRecord?.trashRef ?? null,
    disabledAt: null,
    disabledPath: null,
  }
  upsertRecord(registry, scope.id, request.name, record)
  const groupKey = `${scope.id}|${request.mode === 'source' && catalog ? originKeyOf(catalog) : `local:${targetPath}@`}`
  const group = registry.groups[groupKey]
  const selected = new Set(group?.selectedNames ?? [])
  selected.add(request.name)
  const installed = new Set(group?.installedNames ?? [])
  installed.add(request.name)
  const disabled = new Set(group?.disabledNames ?? [])
  disabled.delete(request.name)
  upsertGroup(registry, groupKey, {
    selectedNames: [...selected],
    installedNames: [...installed],
    disabledNames: [...disabled],
    lastCheckedAt: now,
    lastFetchedAt: now,
    resolvedRef: catalog?.resolvedRef,
    commitSha: catalog?.commitSha,
  })

  try {
    writeSkillManagerRegistry(registry, paths.registryPath)
  }
  catch (error) {
    if (oldRaw) await writeTextAtomic(scope.lockPath, oldRaw).catch(() => undefined)
    else await removePath(lockPath ?? '').catch(() => undefined)
    throw error
  }

  const history: SkillManagerHistoryEntry = {
    id: operationId,
    at: now,
    action: 'adopt',
    scopeId: scope.id,
    operationId,
    names: [request.name],
    status: 'ok',
    groupKey,
    beforeLockRaw: oldRaw || undefined,
    detail: request.mode === 'source' ? '绑定来源接管' : '本地接管：不参与远端更新',
  }
  appendSkillManagerHistory(history, paths.historyPath)

  return {
    scopeId: scope.id,
    name: request.name,
    mode: request.mode,
    lockManaged,
    origin,
    installedAt: record.installedAt,
    lockPath,
    warnings: lockManaged ? [] : ['本地接管：不写锁，更新计划会跳过远端对比'],
  }
}
