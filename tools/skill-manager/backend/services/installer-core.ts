import type {
  GlobalLockEntry,
  GlobalLockFile,
  InstallConflict,
  InstallResult,
  InstallSkillsRequest,
  SkillManagerHistoryEntry,
  SkillManagerRecord,
  SkillOrigin,
  SourceCatalog,
  SourceCatalogEntry,
} from '../../../../shared/skill-manager.ts'
import type { TrashEntry } from './executor.ts'
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { logger } from '../../../../backend/utils/logger.ts'
import { readGlobalLock, writeGlobalLock } from '../locks/global-lock.ts'
import { resolveSource } from '../sources/catalog.ts'
import { cloneGitSource } from '../sources/git.ts'
import { parseSourceInput } from '../sources/parse.ts'
import { downloadGithubTarball, extractTarGz } from './archive.ts'
import {
  commitStagedDirectory,
  copyTreeSafe,
  createTrashSession,
  exists,
  fingerprint,
  InstallTransactionError,
  moveToTrash,
  restoreTrashEntry,
} from './executor.ts'
import { hashSkillDirectory } from './hash.ts'
import { appendSkillManagerHistory } from './history.ts'
import {
  readSkillManagerRegistry,
  upsertGroup,
  upsertRecord,
  writeSkillManagerRegistry,
} from './registry.ts'
import { parseSkillFrontmatter } from './scanner.ts'

const SKILL_FILE = 'SKILL.md'
const STALE_AFTER_MS = 24 * 60 * 60 * 1000
const MAX_NAMES = 200

export interface InstallPaths {
  skillsDir: string
  lockPath: string
  trashRoot: string
  registryPath: string
  historyPath: string
  stagingRoot: string
}

interface PreparedInstall {
  name: string
  entry: SourceCatalogEntry
  stagingDir: string
  contentHash: string
  action: 'install' | 'update'
  existing: GlobalLockEntry | undefined
}

interface CommittedInstall {
  target: string
  trashed: TrashEntry | undefined
}

/** 安装/更新一组技能到全局目录；任何失败都不删除旧目录。 */
export async function installSkillsCore(
  request: InstallSkillsRequest,
  paths: InstallPaths,
): Promise<InstallResult> {
  const scopeId = request.scopeId ?? 'global'
  if (scopeId !== 'global') {
    throw new InstallTransactionError('scope-unsupported', '本步骤只支持安装到全局技能目录')
  }
  const names = normalizeNames(request.names)
  const operationId = `sminstall_${Date.now()}_${randomBytes(4).toString('hex')}`
  const lock = await readGlobalLock(paths.lockPath)
  if (!lock.ok) {
    throw new InstallTransactionError('lock-invalid', `全局锁不可用：${lock.message}`)
  }

  const catalog = await resolveSource(request.input, request.ref)
  const conflicts = await preflight(names, catalog, lock.data, paths)
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
  const committed: CommittedInstall[] = []
  const warnings = [...catalog.warnings]

  try {
    await mkdir(stagingRoot, { recursive: true })
    await stageCatalog(catalog, names, stagingRoot, staged)

    const prepared: PreparedInstall[] = []
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
        existing: lock.data.skills[name],
      })
    }

    // 在改动任何目标目录前确认锁没有被另一个进程改写。
    const beforeCommit = await readGlobalLock(paths.lockPath)
    if (!beforeCommit.ok || beforeCommit.raw !== lock.raw) {
      throw new InstallTransactionError('lock-changed', '全局锁在安装过程中被其他进程修改，已取消安装')
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

    // 提交后再读一次，覆盖 staging 期间的外部写入窗口。
    const beforeWrite = await readGlobalLock(paths.lockPath)
    if (!beforeWrite.ok || beforeWrite.raw !== lock.raw) {
      throw new InstallTransactionError('lock-changed', '全局锁在安装过程中被其他进程修改，已回滚')
    }

    const now = new Date().toISOString()
    const nextLock = buildNextLock(lock.data, prepared, catalog, now)
    const lockRaw = await writeGlobalLock(nextLock, paths.lockPath)

    const installed = prepared.filter(item => item.action === 'install').map(item => item.name)
    const updated = prepared.filter(item => item.action === 'update').map(item => item.name)
    const trashRef = session.entries.length > 0 ? session.id : undefined

    try {
      writeRegistryAfterInstall(prepared, catalog, scopeId, operationId, now, lockRaw, paths)
    }
    catch (error) {
      warnings.push(`registry 写入失败：${(error as Error).message}`)
      logger.warn('Failed to write skill-manager registry', { error: (error as Error).message })
    }

    try {
      appendHistoryAfterInstall(operationId, scopeId, prepared, now, paths)
    }
    catch (error) {
      warnings.push(`history 写入失败：${(error as Error).message}`)
      logger.warn('Failed to write skill-manager history', { error: (error as Error).message })
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
  lock: GlobalLockFile,
  paths: InstallPaths,
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
      conflicts.push({ name, reason: 'untracked-target', message: `目标目录已存在但不在锁中：${name}` })
      continue
    }
    if (existingLock && !sameSource(existingLock, catalog, entry)) {
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

export async function stageCatalog(
  catalog: SourceCatalog,
  names: string[],
  stagingRoot: string,
  staged: Map<string, string>,
): Promise<void> {
  const selected = catalog.entries.filter(entry => names.includes(entry.name))

  if (catalog.sourceType === 'github') {
    const tarball = join(stagingRoot, 'source.tar.gz')
    await downloadGithubTarball(catalog.source, catalog.resolvedRef, tarball, githubToken())
    const unpacked = join(stagingRoot, 'unpacked')
    await extractTarGz(await readFile(tarball), unpacked)
    const sourceRoot = await singleTopDirectory(unpacked)
    for (const entry of selected) await stageEntry(sourceRoot, entry, stagingRoot, staged)
    return
  }

  if (catalog.sourceType === 'git') {
    const repoRoot = join(stagingRoot, 'repo')
    const parsed = parseSourceInput(catalog.source, catalog.ref ?? undefined)
    await cloneGitSource(parsed, repoRoot)
    for (const entry of selected) await stageEntry(repoRoot, entry, stagingRoot, staged)
    return
  }

  if (catalog.sourceType === 'local') {
    const parsed = parseSourceInput(catalog.source)
    if (!parsed.localPath) throw new InstallTransactionError('source-invalid', '本地来源缺少路径')
    for (const entry of selected) await stageEntry(parsed.localPath, entry, stagingRoot, staged)
    return
  }

  throw new InstallTransactionError('source-unsupported', `暂不支持安装来源：${catalog.sourceType}`)
}

async function stageEntry(
  sourceRoot: string,
  entry: SourceCatalogEntry,
  stagingRoot: string,
  staged: Map<string, string>,
): Promise<void> {
  const sourceDir = entry.skillPath === SKILL_FILE
    ? sourceRoot
    : join(sourceRoot, ...dirname(entry.skillPath).split('/'))
  const destination = join(stagingRoot, 'skills', entry.name)
  await mkdir(join(stagingRoot, 'skills'), { recursive: true })
  await copyTreeSafe(sourceDir, destination)
  staged.set(entry.name, destination)
}

export async function validateStagedSkill(
  stagingDir: string,
  name: string,
  entry: SourceCatalogEntry,
  warnings: string[],
): Promise<string> {
  let markdown: string
  try {
    markdown = await readFile(join(stagingDir, SKILL_FILE), 'utf8')
  }
  catch {
    throw new InstallTransactionError('invalid-skill', `技能缺少 SKILL.md：${name}`)
  }
  const frontmatter = parseSkillFrontmatter(markdown)
  if (!frontmatter) {
    throw new InstallTransactionError('invalid-skill', `SKILL.md 缺少合法 frontmatter：${name}`)
  }
  if (frontmatter.name && frontmatter.name !== name) {
    warnings.push(`技能「${name}」的 frontmatter name 为「${frontmatter.name}」，以目录名为准`)
  }
  if (!entry.skillPath.endsWith(SKILL_FILE)) {
    throw new InstallTransactionError('invalid-skill', `来源路径不是 SKILL.md：${name}`)
  }
  return hashSkillDirectory(stagingDir)
}

function buildNextLock(
  lock: GlobalLockFile,
  prepared: PreparedInstall[],
  catalog: SourceCatalog,
  now: string,
): GlobalLockFile {
  const nextSkills: Record<string, GlobalLockEntry> = { ...lock.skills }
  for (const item of prepared) {
    const previous = nextSkills[item.name]
    const entry: GlobalLockEntry = {
      ...previous,
      source: catalog.source,
      sourceType: catalog.sourceType,
      skillPath: item.entry.skillPath,
      skillFolderHash: item.entry.folderSha ?? item.contentHash,
      installedAt: previous?.installedAt ?? now,
      updatedAt: now,
      installMode: 'copy',
    }
    if (catalog.sourceUrl) entry.sourceUrl = catalog.sourceUrl
    else delete entry.sourceUrl
    if (catalog.ref) entry.ref = catalog.ref
    else delete entry.ref
    nextSkills[item.name] = entry
  }
  return { ...lock, version: 3, skills: nextSkills }
}

function writeRegistryAfterInstall(
  prepared: PreparedInstall[],
  catalog: SourceCatalog,
  scopeId: string,
  operationId: string,
  now: string,
  lockRaw: string,
  paths: InstallPaths,
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
  scope.lockFingerprint = fingerprint(lockRaw)

  const groupKey = `global|${originKeyOf(catalog)}`
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

function appendHistoryAfterInstall(
  operationId: string,
  scopeId: string,
  prepared: PreparedInstall[],
  now: string,
  paths: InstallPaths,
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

async function rollbackCommitted(committed: CommittedInstall[]): Promise<void> {
  for (const item of [...committed].reverse()) {
    await rm(item.target, { recursive: true, force: true }).catch(() => {})
    if (item.trashed) await restoreTrashEntry(item.trashed)
  }
}

async function singleTopDirectory(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true })
  const dirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
  if (dirs.length !== 1) {
    throw new InstallTransactionError('archive-layout', '压缩包应只包含一个顶层目录')
  }
  return join(root, dirs[0].name)
}

export function originOf(catalog: SourceCatalog, entry: SourceCatalogEntry): SkillOrigin {
  return {
    sourceType: catalog.sourceType,
    source: catalog.source,
    sourceUrl: catalog.sourceUrl,
    ref: catalog.ref ?? null,
    skillPath: entry.skillPath,
  }
}

export function sameSource(lock: Pick<GlobalLockEntry, 'sourceType' | 'source' | 'skillPath'>, catalog: SourceCatalog, entry: SourceCatalogEntry): boolean {
  return lock.sourceType === catalog.sourceType
    && normalizeSource(lock.source) === normalizeSource(catalog.source)
    && (lock.skillPath ?? entry.skillPath) === entry.skillPath
}

function normalizeSource(value: string): string {
  return value.replace(/\/+$/, '')
}

export function originKeyOf(catalog: SourceCatalog): string {
  return `${catalog.sourceType}:${catalog.source}@${catalog.ref ?? ''}`
}

export async function safeHash(path: string): Promise<string | undefined> {
  try {
    return await hashSkillDirectory(path)
  }
  catch {
    return undefined
  }
}

export async function lstatOrNull(path: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
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

export function normalizeNames(names: string[]): string[] {
  if (!Array.isArray(names) || names.length === 0) {
    throw new InstallTransactionError('empty-selection', '至少选择一个技能')
  }
  if (names.length > MAX_NAMES) {
    throw new InstallTransactionError('too-many-names', `一次最多安装 ${MAX_NAMES} 个技能`)
  }
  return [...new Set(names)]
}

export function isSafeName(name: string): boolean {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= 80
    && !name.startsWith('.')
    && /^[\w.-]+$/.test(name)
}

function githubToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined
}

/** 清理 24 小时前遗留的 staging 与目标目录临时文件夹；启动时调用。 */
export async function cleanupStaleInstallArtifacts(paths: InstallPaths): Promise<void> {
  const now = Date.now()
  await cleanupDirectory(paths.stagingRoot, now, () => true)
  await cleanupDirectory(paths.skillsDir, now, name => name.startsWith('.skill-manager-tmp-'))
}

async function cleanupDirectory(root: string, now: number, predicate: (name: string) => boolean): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(root)
  }
  catch {
    return
  }
  for (const name of entries) {
    if (!predicate(name)) continue
    const path = join(root, name)
    try {
      const info = await stat(path)
      if (now - info.mtimeMs > STALE_AFTER_MS) await rm(path, { recursive: true, force: true })
    }
    catch {
      // 清理失败不阻塞启动
    }
  }
}
