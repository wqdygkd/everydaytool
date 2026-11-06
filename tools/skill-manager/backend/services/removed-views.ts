import type { RemovedSkillView, SkillManagerRecord } from '../../../../shared/skill-manager.ts'

/** 从 registry 生成墓碑视图：removed 永久保留，installed 但目录/锁都不在的标 external。 */
export function buildRemovedViews(
  scopeId: string,
  records: Record<string, SkillManagerRecord>,
  activeNames: Set<string>,
): RemovedSkillView[] {
  const removed: RemovedSkillView[] = []
  for (const record of Object.values(records)) {
    if (activeNames.has(record.name)) continue
    if (record.state === 'removed') {
      removed.push({
        scopeId,
        name: record.name,
        dirName: record.dirName,
        origin: record.origin,
        removedAt: record.removedAt ?? record.updatedAt,
        removedReason: record.removedReason ?? 'uninstall',
        trashRef: record.trashRef ?? undefined,
        lastKnownBaseline: record.baseline.contentHash,
      })
    }
    else if (record.state === 'installed') {
      removed.push({
        scopeId,
        name: record.name,
        dirName: record.dirName,
        origin: record.origin,
        removedAt: record.removedAt ?? record.updatedAt,
        removedReason: 'external',
        trashRef: record.trashRef ?? undefined,
        lastKnownBaseline: record.baseline.contentHash,
      })
    }
  }
  return removed.sort((a, b) => b.removedAt.localeCompare(a.removedAt) || a.name.localeCompare(b.name))
}
