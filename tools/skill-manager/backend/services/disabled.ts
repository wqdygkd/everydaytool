import type {
  GlobalLockEntry,
  ProjectLockEntry,
  Scope,
  SetEnabledRequest,
  SetEnabledResult,
  SkillManagerDisabledEntry,
  SkillManagerGroupRecord,
  SkillManagerHistoryEntry,
  SkillManagerRecord,
  SkillOrigin,
} from '../../../../shared/skill-manager.ts'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readlink, rename, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { readGlobalLock, writeGlobalLock } from '../locks/global-lock.ts'
import { readProjectLock, writeProjectLock } from '../locks/project-lock.ts'
import { readDisabledIndex, writeDisabledIndex } from './disabled-index.ts'
import { copyTreeSafe, createTrashSession, exists, moveToTrash, writeTextAtomic } from './executor.ts'
import { hashSkillDirectory } from './hash.ts'
import { appendSkillManagerHistory } from './history.ts'
import { readSkillManagerRegistry, upsertGroup, upsertRecord, writeSkillManagerRegistry } from './registry.ts'

export interface DisabledPaths {
  disabledRoot: string
  registryPath: string
  historyPath: string
  backupRoot: string
  trashRoot?: string
  disabledLockPolicy?: 'delete' | 'keep'
}

interface AnyLock { version: number, skills: Record<string, GlobalLockEntry | ProjectLockEntry>, [key: string]: unknown }

function nowIso(): string {
  return new Date().toISOString()
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function originKey(origin: SkillOrigin): string {
  return `${origin.sourceType}:${origin.source}@${origin.ref ?? ''}`
}

function safeName(name: string): string {
  if (!name || name === '.' || name === '..' || name.startsWith('.') || /[\\/]/.test(name)) {
    throw new Error(`非法技能名：${name}`)
  }
  return name
}

function scopeGroupPrefix(scope: Scope): string {
  return scope.kind === 'global' ? 'global' : scope.id
}

function groupKeyFor(scope: Scope, registry: ReturnType<typeof readSkillManagerRegistry>, origin: SkillOrigin): string {
  const prefix = `${scopeGroupPrefix(scope)}|`
  const suffix = `|${originKey(origin)}`
  return Object.keys(registry.groups).find(key => key.startsWith(prefix) && key.endsWith(suffix)) ?? `${prefix}${originKey(origin)}`
}

function lockForScope(scope: Scope): Promise<{ ok: boolean, exists: boolean, raw: string, data: AnyLock, message?: string }> {
  return (scope.kind === 'global' ? readGlobalLock(scope.lockPath) : readProjectLock(scope.projectPath ?? process.cwd())) as Promise<{
    ok: boolean
    exists: boolean
    raw: string
    data: AnyLock
    message?: string
  }>
}

async function writeLockForScope(
  scope: Scope,
  lock: AnyLock,
  operationId: string,
  paths: DisabledPaths,
  expectedRaw: string,
): Promise<string> {
  if (scope.kind === 'global') {
    const raw = await writeGlobalLock(lock as never, scope.lockPath)
    return raw
  }
  const result = await writeProjectLock(lock as never, scope.projectPath ?? process.cwd(), {
    operationId,
    backupRoot: paths.backupRoot,
    expectedRaw,
  })
  return result.raw
}

function recordFor(entry: SkillManagerDisabledEntry, previous: SkillManagerRecord | undefined, timestamp: string, enabled: boolean): SkillManagerRecord {
  return {
    name: entry.name,
    dirName: entry.name,
    origin: entry.origin,
    installMode: entry.installMode,
    baseline: previous?.baseline ?? {
      contentHash: entry.contentHash ?? '',
      capturedAt: timestamp,
      source: 'repair',
    },
    remote: previous?.remote ?? { fetchedAt: timestamp },
    tracked: true,
    forked: false,
    state: 'installed',
    installedAt: previous?.installedAt ?? timestamp,
    updatedAt: timestamp,
    removedAt: null,
    removedReason: null,
    trashRef: null,
    disabledAt: enabled ? null : entry.disabledAt,
    disabledPath: null,
  }
}

function makeGlobalEntry(entry: SkillManagerDisabledEntry): GlobalLockEntry {
  const timestamp = entry.disabledAt
  return {
    source: entry.origin.source,
    sourceType: entry.origin.sourceType,
    sourceUrl: entry.origin.sourceUrl,
    ref: entry.origin.ref ?? undefined,
    skillPath: entry.origin.skillPath,
    skillFolderHash: entry.contentHash ?? '',
    installedAt: timestamp,
    updatedAt: timestamp,
    installMode: 'copy',
  }
}

function makeProjectEntry(entry: SkillManagerDisabledEntry): ProjectLockEntry {
  return {
    source: entry.origin.source,
    sourceType: entry.origin.sourceType,
    sourceUrl: entry.origin.sourceUrl,
    ref: entry.origin.ref ?? undefined,
    skillPath: entry.origin.skillPath,
    computedHash: entry.contentHash ?? '',
    installMode: 'copy',
  }
}

function upsertDisabledRegistry(
  scope: Scope,
  entries: SkillManagerDisabledEntry[],
  enabled: boolean,
  operationId: string,
  paths: DisabledPaths,
): void {
  const registry = readSkillManagerRegistry(paths.registryPath)
  const timestamp = nowIso()
  const byGroup = new Map<string, { names: string[], records: Array<[string, SkillManagerRecord]> }>()
  for (const entry of entries) {
    const key = groupKeyFor(scope, registry, entry.origin)
    const bucket = byGroup.get(key) ?? { names: [], records: [] }
    bucket.names.push(entry.name)
    bucket.records.push([entry.name, recordFor(entry, registry.scopes[scope.id]?.records[entry.name], timestamp, enabled)])
    byGroup.set(key, bucket)
  }
  for (const [groupKey, bucket] of byGroup) {
    const previous = registry.groups[groupKey]
    const disabledNames = enabled
      ? (previous?.disabledNames ?? []).filter(name => !bucket.names.includes(name))
      : unique([...(previous?.disabledNames ?? []), ...bucket.names])
    const installedNames = enabled
      ? unique([...(previous?.installedNames ?? []), ...bucket.names])
      : (previous?.installedNames ?? []).filter(name => !bucket.names.includes(name))
    upsertGroup(registry, groupKey, {
      selectedNames: unique([...(previous?.selectedNames ?? []), ...bucket.names]),
      installedNames,
      disabledNames,
      lastPlanId: operationId,
    } as Partial<SkillManagerGroupRecord>)
    for (const [name, record] of bucket.records) upsertRecord(registry, scope.id, name, record)
  }
  const scopeRegistry = registry.scopes[scope.id] ?? { records: {} }
  scopeRegistry.lastScanAt = timestamp
  registry.scopes[scope.id] = scopeRegistry
  writeSkillManagerRegistry(registry, paths.registryPath)
}

async function acquireEntry(scope: Scope, name: string): Promise<{ mode: 'copy' | 'symlink', source: string, target: string, linkTarget?: string, contentHash: string }> {
  const source = join(scope.skillsDir, name)
  const info = await lstat(source)
  if (info.isSymbolicLink()) {
    const linkTarget = await readlink(source)
    let contentHash = ''
    try {
      contentHash = await hashSkillDirectory(source)
    }
    catch {}
    return { mode: 'symlink', source, target: '', linkTarget, contentHash }
  }
  if (!info.isDirectory()) throw new Error(`不是技能目录：${name}`)
  return { mode: 'copy', source, target: '', contentHash: await hashSkillDirectory(source) }
}

/** 禁用/启用共用一个事务：目录移动、锁、registry、history 任一失败都回滚。 */
export async function setEnabledCore(request: SetEnabledRequest, scope: Scope, paths: DisabledPaths): Promise<SetEnabledResult> {
  const names = unique(request.names.map(safeName))
  if (names.length === 0) throw new Error('至少选择一个技能')
  const operationId = `op_${randomUUID()}`
  const index = await readDisabledIndex(paths.disabledRoot, scope.id)
  const lock = await lockForScope(scope)
  if (!lock.ok) throw new Error(lock.message ?? '无法读取锁文件')
  const lockRawBefore = lock.raw
  const previousIndexRaw = `${JSON.stringify(index, null, 2)}\n`
  const previousRegistryRaw = await readRegistryRaw(paths.registryPath)
  const warnings: string[] = []
  const moved: Array<{ name: string, from: string, to: string, mode: 'copy' | 'symlink', linkTarget?: string }> = []
  const resultEntries: SkillManagerDisabledEntry[] = []
  const touchedLock = JSON.parse(JSON.stringify(lock.data)) as AnyLock

  try {
    await mkdir(join(paths.disabledRoot, scope.id.replace(/[^\w.-]+/g, '_')), { recursive: true })
    for (const name of names) {
      if (request.enabled) {
        const entry = index.entries[name]
        if (!entry) throw new Error(`未找到禁用记录：${name}`)
        const target = join(scope.skillsDir, name)
        if (await exists(target)) throw new Error(`启用目标已存在：${name}`)
        if (entry.installMode === 'symlink') {
          const linkTarget = entry.linkTarget
          if (!linkTarget) throw new Error(`禁用记录缺少链接目标：${name}`)
          try {
            await symlink(linkTarget, target, 'dir')
          }
          catch {
            // Windows 无创建链接权限时退回复制链接目标；目标不存在则保留错误。
            await copyTreeSafe(linkTarget, target)
            warnings.push(`${name}：创建符号链接失败，已复制目标目录`)
          }
          moved.push({ name, from: '', to: target, mode: 'symlink', linkTarget })
        }
        else {
          const from = join(paths.disabledRoot, scope.id.replace(/[^\w.-]+/g, '_'), name)
          if (!(await exists(from))) throw new Error(`禁用目录不存在：${name}`)
          await moveDir(from, target)
          moved.push({ name, from, to: target, mode: 'copy' })
        }
        const restoredHash = entry.contentHash ? await hashSkillDirectory(target).catch(() => '') : ''
        if (entry.contentHash && restoredHash && restoredHash !== entry.contentHash) {
          warnings.push(`${name}：启用后内容 hash 与禁用前不同`)
        }
        const lockEntry = { ...(entry.lockEntry ?? (scope.kind === 'global' ? makeGlobalEntry(entry) : makeProjectEntry(entry))) }
        if (entry.contentHash) {
          lockEntry.skillFolderHash = entry.contentHash
          lockEntry.computedHash = entry.contentHash
        }
        lockEntry.updatedAt = nowIso()
        touchedLock.skills[name] = lockEntry as GlobalLockEntry | ProjectLockEntry
        resultEntries.push(entry)
        delete index.entries[name]
      }
      else {
        if (!touchedLock.skills[name] && !index.entries[name]) {
          throw new Error(`未托管技能不能禁用，请先接管：${name}`)
        }
        const acquired = await acquireEntry(scope, name)
        const target = join(paths.disabledRoot, scope.id.replace(/[^\w.-]+/g, '_'), name)
        const targetExists = await exists(target)
        if (targetExists) {
          // disabled-drift：禁用区已有同名副本。保留禁用副本，把重新出现的活动目录移入回收站。
          if (!index.entries[name]) throw new Error(`禁用目标已存在：${name}`)
          if (!paths.trashRoot) throw new Error(`缺少回收站路径，无法处理冲突：${name}`)
          if (acquired.mode === 'symlink') {
            await rm(acquired.source, { force: true })
          }
          else {
            const session = await createTrashSession(paths.trashRoot, operationId, scope.id, 'disabled-drift')
            await moveToTrash(session, acquired.source, name, touchedLock.skills[name] ? originFromLock(touchedLock.skills[name], scope, name) : index.entries[name].origin, acquired.contentHash)
          }
          resultEntries.push(index.entries[name])
          if (scope.kind === 'global') delete touchedLock.skills[name]
          continue
        }
        if (acquired.mode === 'symlink') {
          await rm(acquired.source, { force: true })
        }
        else {
          await moveDir(acquired.source, target)
        }
        const lockEntry = touchedLock.skills[name]
        const disabledEntry: SkillManagerDisabledEntry = {
          name,
          scopeId: scope.id,
          groupKey: groupKeyFor(scope, readSkillManagerRegistry(paths.registryPath), originFromLock(lockEntry, scope, name)),
          origin: lockEntry ? originFromLock(lockEntry, scope, name) : index.entries[name].origin,
          installMode: acquired.mode,
          linkTarget: acquired.linkTarget,
          contentHash: acquired.contentHash,
          disabledAt: nowIso(),
          lockEntry: lockEntry ? JSON.parse(JSON.stringify(lockEntry)) as Record<string, unknown> : undefined,
        }
        index.entries[name] = disabledEntry
        resultEntries.push(disabledEntry)
        moved.push({ name, from: acquired.source, to: target, mode: acquired.mode, linkTarget: acquired.linkTarget })
        // 全局锁要删条目；项目锁保留。索引在两种 scope 下都保存原条目，供启用恢复。
        if (scope.kind === 'global') delete touchedLock.skills[name]
      }
    }

    await (scope.kind === 'global'
      ? writeGlobalLock(touchedLock as never, scope.lockPath)
      : writeLockForScope(scope, touchedLock, operationId, paths, lockRawBefore))
    await writeDisabledIndex(index, paths.disabledRoot)
    upsertDisabledRegistry(scope, resultEntries, request.enabled, operationId, paths)
    const historyId = `hist_${operationId}`
    const history: SkillManagerHistoryEntry = {
      id: historyId,
      at: nowIso(),
      action: request.enabled ? 'enable' : 'disable',
      scopeId: scope.id,
      operationId,
      names,
      status: 'ok',
      detail: request.enabled ? '从禁用区启用' : '移入禁用区',
    }
    appendSkillManagerHistory(history, paths.historyPath)
    return {
      operationId,
      scopeId: scope.id,
      enabled: request.enabled ? names : [],
      disabled: request.enabled ? [] : names,
      warnings,
      lockPath: scope.lockPath,
      disabledRoot: paths.disabledRoot,
      historyId,
    }
  }
  catch (error) {
    await rollbackMoved(moved, request.enabled)
    await writeTextAtomic(scope.lockPath, lockRawBefore).catch(() => {})
    await writeDisabledIndex(parseIndex(previousIndexRaw, scope.id), paths.disabledRoot).catch(() => {})
    await writeTextAtomic(paths.registryPath, previousRegistryRaw).catch(() => {})
    throw error
  }
}

function parseIndex(raw: string, scopeId: string): ReturnType<typeof JSON.parse> {
  try {
    const parsed = JSON.parse(raw)
    return { version: 1, scopeId, entries: parsed.entries ?? {} }
  }
  catch {
    return { version: 1, scopeId, entries: {} }
  }
}

async function readRegistryRaw(path: string): Promise<string> {
  try {
    return await (await import('node:fs/promises')).readFile(path, 'utf8')
  }
  catch {
    return ''
  }
}

function originFromLock(lockEntry: GlobalLockEntry | ProjectLockEntry | undefined, scope: Scope, name: string): SkillOrigin {
  if (lockEntry) {
    return {
      sourceType: (lockEntry.sourceType as SkillOrigin['sourceType']) ?? 'unknown',
      source: lockEntry.source,
      sourceUrl: lockEntry.sourceUrl,
      ref: lockEntry.ref ?? null,
      skillPath: lockEntry.skillPath,
    }
  }
  return {
    sourceType: 'unknown',
    source: `${scope.kind}:${name}`,
    ref: null,
    skillPath: undefined,
  }
}

async function rollbackMoved(
  moved: Array<{ name: string, from: string, to: string, mode: 'copy' | 'symlink', linkTarget?: string }>,
  enabling: boolean,
): Promise<void> {
  for (const item of [...moved].reverse()) {
    if (enabling) {
      await rm(item.to, { recursive: true, force: true }).catch(() => {})
      if (item.mode === 'copy' && item.from) await moveDir(item.to, item.from).catch(() => {})
    }
    else {
      await rm(item.to, { recursive: true, force: true }).catch(() => {})
      if (item.mode === 'copy') await moveDir(item.to, item.from).catch(() => {})
      if (item.mode === 'symlink' && item.linkTarget) await symlink(item.linkTarget, item.from, 'dir').catch(() => {})
    }
  }
}

async function moveDir(from: string, to: string): Promise<void> {
  await mkdir(join(to, '..'), { recursive: true })
  try {
    await rename(from, to)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await copyTreeSafe(from, to)
    await rm(from, { recursive: true, force: true })
  }
}
