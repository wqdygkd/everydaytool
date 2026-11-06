import type {
  InstallConflict,
  InstallResult,
  InstallSkillsRequest,
  ProjectLockEntry,
  ProjectLockFile,
  SkillManagerHistoryEntry,
  SkillManagerRecord,
  SourceCatalog,
  SourceCatalogEntry,
} from '../../../../shared/skill-manager.ts'
import type { TrashEntry } from './executor.ts'
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { logger } from '../../../../backend/utils/logger.ts'
import { readProjectLock, writeProjectLock } from '../locks/project-lock.ts'
import { resolveSource } from '../sources/catalog.ts'
import {
  commitStagedDirectory,
  createTrashSession,
  exists,
  InstallTransactionError,
  moveToTrash,
  restoreTrashEntry,
} from './executor.ts'
import { hashSkillDirectory } from './hash.ts'
import { appendSkillManagerHistory } from './history.ts'
import {
  isSafeName,
  normalizeNames,
  originKeyOf,
  originOf,
  stageCatalog,
  validateStagedSkill,
} from './installer-core.ts'
import { projectScopeId } from './projects.ts'
import {
  readSkillManagerRegistry,
  upsertGroup,
  upsertRecord,
  writeSkillManagerRegistry,
} from './registry.ts'

export interface ProjectInstallPaths {
  projectPath: string
  skillsDir: string
  lockPath: string
  trashRoot: string
  registryPath: string
  historyPath: string
  stagingRoot: string
  backupRoot: string
}

interface PreparedProjectInstall {
  name: string
  entry: SourceCatalogEntry
  stagingDir: string
  contentHash: string
  action: 'install' | 'update'
}

interface CommittedProjectInstall {
  target: string
  trashed: TrashEntry | undefined
}

/** 安装/更新一组技能到项目目录，只写项目锁 v1；失败不删除旧目录。 */
export async function installSkillsToProject(
  request: InstallSkillsRequest,
  paths: ProjectInstallPaths,
): Promise<InstallResult> {
  const requestedProject = request.projectPath ? resolve(request.projectPath) : paths.projectPath
  if (requestedProject !== paths.projectPath) {
    throw new InstallTransactionError('project-mismatch', '项目路径与安装目标不一致')
  }
  const projectPath = await realpath(requestedProject)
  const scopeId = request.scopeId?.startsWith('project:') ? request.scopeId : projectScopeId(projectPath)
  const names = normalizeNames(request.names)
  const operationId = `smproj_${Date.now()}_${randomBytes(4).toString('hex')}`

  const lock = await readProjectLock(projectPath)
  if (!lock.ok) {
    throw new InstallTransactionError('lock-invalid', `项目锁不可用：${lock.message}`)
  }

  const catalog = await resolveSource(request.input, request.ref)
  if (catalog.sourceType === 'local') catalog.source = await realpath(catalog.source)
  const conflicts = await preflight(names, catalog, lock.data, projectPath, paths)
  if (conflicts.length > 0) {
    return {
      operationId,
      scopeId,
      status: 'conflict',
      installed: [],
      updated: [],
      conflicts,
      warnings: catalog.warnings,
      lockPath: paths.lockPath,
      registryPath: paths.registryPath,
    }
  }

  const stagingRoot = join(paths.stagingRoot, operationId)
  const staged = new Map<string, string>()
  const session = createTrashSession(paths.trashRoot, operationId, scopeId, 'install')
  const committed: CommittedProjectInstall[] = []
  const warnings = [...catalog.warnings]

  try {
    await mkdir(stagingRoot, { recursive: true })
    await stageCatalog(catalog, names, stagingRoot, staged)

    const prepared: PreparedProjectInstall[] = []
    for (const name of names) {
      const entry = catalog.entries.find(item => item.name === name)!
      const stagingDir = staged.get(name)
      if (!stagingDir) throw new InstallTransactionError('staging-missing', `未生成暂存目录：${name}`)
      const contentHash = await validateStagedSkill(stagingDir, name, entry, warnings)
      prepared.push({
        name,
        entry,
        stagingDir,
        contentHash,
        action: await exists(join(paths.skillsDir, name)) ? 'update' : 'install',
      })
    }

    const beforeCommit = await readProjectLock(projectPath)
    if (!beforeCommit.ok || beforeCommit.raw !== lock.raw) {
      throw new InstallTransactionError('lock-changed', 'skills-lock.json 在安装过程中被修改，已取消安装')
    }

    for (const item of prepared) {
      const target = join(paths.skillsDir, item.name)
      let trashed: TrashEntry | undefined
      if (await exists(target)) {
        trashed = await moveToTrash(session, target, item.name, originOf(catalog, item.entry), await safeHash(target))
      }
      try {
        await commitStagedDirectory(item.stagingDir, paths.skillsDir, item.name, operationId)
      }
      catch (error) {
        if (trashed) await restoreTrashEntry(trashed).catch(() => {})
        throw error
      }
      committed.push({ target, trashed })
    }

    const now = new Date().toISOString()
    const nextLock = buildNextProjectLock(lock.data, prepared, catalog, projectPath)
    const written = await writeProjectLock(nextLock, projectPath, {
      operationId,
      backupRoot: paths.backupRoot,
      expectedRaw: lock.raw,
    })

    const installed = prepared.filter(item => item.action === 'install').map(item => item.name)
    const updated = prepared.filter(item => item.action === 'update').map(item => item.name)
    const trashRef = session.entries.length > 0 ? session.id : undefined

    try {
      writeRegistryAfterProjectInstall(prepared, catalog, scopeId, operationId, now, written.fingerprint, paths)
    }
    catch (error) {
      warnings.push(`registry 写入失败：${(error as Error).message}`)
      logger.warn('Failed to write skill-manager project registry', { error: (error as Error).message })
    }

    try {
      appendProjectHistory(operationId, scopeId, prepared, now, paths)
    }
    catch (error) {
      warnings.push(`history 写入失败：${(error as Error).message}`)
      logger.warn('Failed to write skill-manager project history', { error: (error as Error).message })
    }

    return {
      operationId,
      scopeId,
      status: 'ok',
      installed,
      updated,
      conflicts: [],
      warnings,
      lockPath: paths.lockPath,
      registryPath: paths.registryPath,
      trashRef,
    }
  }
  catch (error) {
    await rollbackCommitted(committed).catch((rollbackError) => {
      warnings.push(`回滚失败：${(rollbackError as Error).message}`)
    })
    throw error
  }
  finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {})
  }
}

async function preflight(
  names: string[],
  catalog: SourceCatalog,
  lock: ProjectLockFile,
  projectPath: string,
  paths: ProjectInstallPaths,
): Promise<InstallConflict[]> {
  const conflicts: InstallConflict[] = []
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) {
      conflicts.push({ name, reason: 'duplicate-name', message: `选择中重复出现：${name}` })
      continue
    }
    seen.add(name)
    if (!isSafeName(name)) {
      conflicts.push({ name, reason: 'invalid-name', message: `技能名不合法：${name}` })
      continue
    }
    const candidates = catalog.entries.filter(entry => entry.name === name)
    if (candidates.length === 0) {
      throw new InstallTransactionError('skill-not-found', `来源中找不到技能：${name}`)
    }
    if (candidates.length > 1) {
      conflicts.push({ name, reason: 'ambiguous-name', message: `来源中有多个同名技能：${name}` })
      continue
    }
    const entry = candidates[0]
    const existingLock = lock.skills[name]
    const target = join(paths.skillsDir, name)
    const info = await lstatOrNull(target)

    if (info?.isSymbolicLink()) {
      conflicts.push({ name, reason: 'symlink-target', message: `目标是符号链接，拒绝覆盖：${name}` })
      continue
    }
    if (info && !existingLock) {
      conflicts.push({ name, reason: 'untracked-target', message: `目标目录已存在但不在项目锁中：${name}` })
      continue
    }
    if (existingLock && !sameProjectSource(existingLock, catalog, entry, projectPath)) {
      conflicts.push({
        name,
        reason: 'different-source',
        message: `同名技能来自不同来源：${name}`,
        existingSource: `${existingLock.sourceType}:${existingLock.source}`,
        incomingSource: `${catalog.sourceType}:${catalog.source}`,
      })
    }
  }
  return conflicts
}

function buildNextProjectLock(
  lock: ProjectLockFile,
  prepared: PreparedProjectInstall[],
  catalog: SourceCatalog,
  projectPath: string,
): ProjectLockFile {
  const skills: Record<string, ProjectLockEntry> = { ...lock.skills }
  for (const item of prepared) {
    const previous = skills[item.name]
    const source = projectSource(catalog, projectPath)
    const entry: ProjectLockEntry = {
      ...previous,
      source,
      sourceType: catalog.sourceType,
      skillPath: item.entry.skillPath,
      computedHash: item.contentHash,
    }
    if (catalog.sourceType === 'git') entry.sourceUrl = catalog.sourceUrl ?? source
    else if (previous?.sourceUrl) entry.sourceUrl = previous.sourceUrl
    else delete entry.sourceUrl
    if (catalog.ref) entry.ref = catalog.ref
    else delete entry.ref
    skills[item.name] = entry
  }
  return { ...lock, version: 1, skills }
}

function projectSource(catalog: SourceCatalog, projectPath: string): string {
  if (catalog.sourceType !== 'local' || !isAbsolute(catalog.source)) return catalog.source
  const relativePath = relative(projectPath, catalog.source)
  if (!relativePath || isAbsolute(relativePath)) return catalog.source
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`
}

function sameProjectSource(
  lock: ProjectLockEntry,
  catalog: SourceCatalog,
  entry: SourceCatalogEntry,
  projectPath: string,
): boolean {
  if (lock.sourceType !== catalog.sourceType) return false
  if ((lock.skillPath ?? entry.skillPath) !== entry.skillPath) return false
  if (lock.sourceType === 'local') {
    return resolve(projectPath, lock.source) === resolve(catalog.source)
  }
  return stripTrailingSlash(lock.source) === stripTrailingSlash(catalog.source)
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function writeRegistryAfterProjectInstall(
  prepared: PreparedProjectInstall[],
  catalog: SourceCatalog,
  scopeId: string,
  operationId: string,
  now: string,
  lockFingerprint: string,
  paths: ProjectInstallPaths,
): void {
  const registry = readSkillManagerRegistry(paths.registryPath)
  const scope = registry.scopes[scopeId] ?? { records: {} }
  registry.scopes[scopeId] = scope
  for (const item of prepared) {
    const previous = scope.records[item.name]
    const record: SkillManagerRecord = {
      name: item.name,
      dirName: item.name,
      origin: originOf(catalog, item.entry),
      installMode: 'copy',
      baseline: { contentHash: item.contentHash, capturedAt: now, source: 'install' },
      remote: {
        folderSha: item.entry.folderSha,
        resolvedRef: catalog.resolvedRef,
        commitSha: catalog.commitSha,
        fetchedAt: now,
      },
      tracked: true,
      forked: false,
      state: 'installed',
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
      removedAt: null,
      removedReason: null,
      trashRef: null,
    }
    upsertRecord(registry, scopeId, item.name, record)
  }
  scope.lastScanAt = now
  scope.lockFingerprint = lockFingerprint

  const groupKey = `${scopeId}|${originKeyOf(catalog)}`
  const previous = registry.groups[groupKey]
  upsertGroup(registry, groupKey, {
    selectedNames: unique([...(previous?.selectedNames ?? []), ...prepared.map(item => item.name)]),
    installedNames: unique([...(previous?.installedNames ?? []), ...prepared.map(item => item.name)]),
    lastFetchedNames: catalog.entries.map(entry => entry.name),
    lastFetchedAt: now,
    resolvedRef: catalog.resolvedRef,
    commitSha: catalog.commitSha,
    lastPlanId: operationId,
  })
  writeSkillManagerRegistry(registry, paths.registryPath)
}

function appendProjectHistory(
  operationId: string,
  scopeId: string,
  prepared: PreparedProjectInstall[],
  now: string,
  paths: ProjectInstallPaths,
): void {
  const entry: SkillManagerHistoryEntry = {
    id: `hist_${operationId}`,
    at: now,
    action: prepared.some(item => item.action === 'update') ? 'update' : 'install',
    scopeId,
    operationId,
    names: prepared.map(item => item.name),
    status: 'ok',
  }
  appendSkillManagerHistory(entry, paths.historyPath)
}

async function rollbackCommitted(committed: CommittedProjectInstall[]): Promise<void> {
  for (const item of [...committed].reverse()) {
    await rm(item.target, { recursive: true, force: true }).catch(() => {})
    if (item.trashed) await restoreTrashEntry(item.trashed)
  }
}

async function safeHash(path: string): Promise<string | undefined> {
  try {
    return await hashSkillDirectory(path)
  }
  catch {
    return undefined
  }
}

async function lstatOrNull(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path)
  }
  catch {
    return null
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
