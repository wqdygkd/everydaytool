import type {
  DeleteSkillRequest,
  DeleteSkillResult,
  InstalledSkill,
  Scope,
  SkillManagerHistoryEntry,
  SkillManagerRecord,
} from '../../../../shared/skill-manager.ts'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createTrashSession, moveToTrash } from './executor.ts'
import { hashSkillDirectory } from './hash.ts'
import { appendSkillManagerHistory } from './history.ts'
import { readSkillManagerRegistry, upsertRecord, writeSkillManagerRegistry } from './registry.ts'

export interface DeleteSkillPaths {
  trashRoot: string
  registryPath: string
  historyPath: string
}

export class DeleteSkillError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export async function deleteSkillCore(
  request: DeleteSkillRequest,
  scope: Scope,
  skill: InstalledSkill,
  paths: DeleteSkillPaths,
): Promise<DeleteSkillResult> {
  if (skill.tracked && skill.lockManaged !== false) {
    throw new DeleteSkillError('managed-skill', `技能 ${request.name} 仍有锁记录，请先从来源更新/移除`)
  }
  if (skill.state !== 'orphan' && skill.state !== 'linked' && skill.lockManaged !== false) {
    throw new DeleteSkillError('not-orphan', `只有未托管技能可以直接删除：${request.name}`)
  }

  const now = new Date().toISOString()
  const operationId = randomUUID()
  const registry = readSkillManagerRegistry(paths.registryPath)
  const previous = registry.scopes[scope.id]?.records[request.name]
  const targetPath = join(scope.skillsDir, skill.dirName)
  const contentHash = await hashSkillDirectory(targetPath)
  const session = createTrashSession(paths.trashRoot, operationId, scope.id, 'uninstall')
  await moveToTrash(session, targetPath, request.name, skill.origin, contentHash)
  const record: SkillManagerRecord = {
    name: request.name,
    dirName: request.name,
    origin: previous?.origin ?? skill.origin,
    installMode: skill.installMode,
    baseline: previous?.baseline ?? { contentHash, capturedAt: now, source: 'scan' },
    remote: previous?.remote ?? { fetchedAt: now },
    tracked: false,
    forked: false,
    lockManaged: false,
    state: 'removed',
    installedAt: previous?.installedAt ?? now,
    updatedAt: now,
    removedAt: now,
    removedReason: 'uninstall',
    trashRef: operationId,
    disabledAt: null,
    disabledPath: null,
  }
  upsertRecord(registry, scope.id, request.name, record)

  for (const group of Object.values(registry.groups)) {
    group.selectedNames = group.selectedNames.filter(name => name !== request.name)
    group.installedNames = group.installedNames.filter(name => name !== request.name)
    group.disabledNames = group.disabledNames.filter(name => name !== request.name)
  }
  writeSkillManagerRegistry(registry, paths.registryPath)

  const history: SkillManagerHistoryEntry = {
    id: operationId,
    at: now,
    action: 'uninstall',
    scopeId: scope.id,
    operationId,
    names: [request.name],
    status: 'ok',
    trashRef: operationId,
    trashEntries: session.entries.map(entry => ({ ...entry })),
    detail: '未托管技能删除到回收站',
  }
  appendSkillManagerHistory(history, paths.historyPath)

  return {
    scopeId: scope.id,
    name: request.name,
    operationId,
    trashRef: operationId,
  }
}
