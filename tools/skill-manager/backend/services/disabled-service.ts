import type { Scope, SetEnabledRequest, SetEnabledResult } from '../../../../shared/skill-manager.ts'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readDisabledIndex } from './disabled-index.ts'
import { setEnabledCore } from './disabled.ts'
import { exists } from './executor.ts'
import {
  getDefaultDisabledRoot,
  getDefaultHistoryPath,
  getDefaultLockBackupRoot,
  getDefaultRegistryPath,
  getDefaultSkillManagerSettingsPath,
  getDefaultTrashRoot,
} from './installer.ts'
import { readSkillManagerRegistry } from './registry.ts'
import { buildRemovedViews } from './removed-views.ts'
import { buildGroups, scanInventory, summaryOf } from './scanner.ts'
import { readSkillManagerSettings } from './settings.ts'

export interface DisabledDrift {
  scopeId: string
  name: string
  reason: string
}

function defaultDisabledPaths() {
  const settings = readSkillManagerSettings(getDefaultSkillManagerSettingsPath())
  return {
    disabledRoot: getDefaultDisabledRoot(),
    registryPath: getDefaultRegistryPath(),
    historyPath: getDefaultHistoryPath(),
    backupRoot: getDefaultLockBackupRoot(),
    trashRoot: getDefaultTrashRoot(),
    disabledLockPolicy: settings.disabledLockPolicy,
  }
}

export async function setSkillEnabled(request: SetEnabledRequest): Promise<SetEnabledResult> {
  const inventory = await scanInventory()
  const scope = inventory.scopes.find(item => item.scope.id === request.scopeId)?.scope
  if (!scope) throw new Error(`未找到作用域：${request.scopeId}`)
  return setEnabledCore(request, scope, defaultDisabledPaths())
}

/** 只读检测：禁用索引存在但活动目录又出现。 */
export async function detectDisabledDrift(): Promise<DisabledDrift[]> {
  const inventory = await scanInventory()
  const drifting: DisabledDrift[] = []
  for (const item of inventory.scopes) {
    const index = await readDisabledIndex(getDefaultDisabledRoot(), item.scope.id)
    for (const entry of Object.values(index.entries)) {
      if (await exists(join(item.scope.skillsDir, entry.name))) {
        drifting.push({ scopeId: item.scope.id, name: entry.name, reason: '禁用记录存在，但活动目录再次出现' })
      }
    }
  }
  return drifting
}

export function disabledSkillPath(scope: Scope, name: string): string {
  return join(scope.skillsDir, name)
}

/** 在只读扫描结果上合并禁用区；活动目录与禁用索引同时存在时标 disabled-drift。 */
export async function scanInventoryWithDisabled() {
  const settings = readSkillManagerSettings(getDefaultSkillManagerSettingsPath())
  if (settings.autoReDisable) {
    const preliminary = await scanInventory()
    for (const item of preliminary.scopes) {
      const index = await readDisabledIndex(getDefaultDisabledRoot(), item.scope.id)
      const drifting = Object.values(index.entries)
        .filter(entry => existsSync(join(item.scope.skillsDir, entry.name)))
        .map(entry => entry.name)
      if (!drifting.length) continue
      await setEnabledCore(
        { scopeId: item.scope.id, names: drifting, enabled: false },
        item.scope,
        defaultDisabledPaths(),
      ).catch(() => undefined)
    }
  }
  const inventory = await scanInventory()
  const registry = readSkillManagerRegistry(getDefaultRegistryPath())
  for (const item of inventory.scopes) {
    const index = await readDisabledIndex(getDefaultDisabledRoot(), item.scope.id)
    const existing = new Map(item.skills.map(skill => [skill.name, skill]))

    // 本地接管不写锁，扫描器会把它当 orphan；用 registry 把它纳入可管理集。
    for (const record of Object.values(registry.scopes[item.scope.id]?.records ?? {})) {
      if (record.state !== 'installed' || record.lockManaged !== false) continue
      const active = existing.get(record.name)
      if (!active) continue
      active.origin = record.origin
      active.tracked = true
      active.lockManaged = false
      active.state = 'ok'
      active.stateReasons = [...active.stateReasons, '本地接管：不参与远端更新']
      active.baselineHash = record.baseline.contentHash
    }

    for (const entry of Object.values(index.entries)) {
      const active = existing.get(entry.name)
      if (active) {
        active.state = 'disabled-drift'
        active.disabled = false
        active.stateReasons = [...active.stateReasons, '禁用记录存在，但活动目录再次出现']
        item.diagnostics.push({
          level: 'warning',
          code: 'disabled-drift',
          scopeId: item.scope.id,
          name: entry.name,
          message: `${entry.name}：禁用记录存在，但活动目录再次出现`,
        })
        continue
      }
      const skill = {
        key: `${item.scope.id}:${entry.name}`,
        name: entry.name,
        dirName: entry.name,
        scopeId: item.scope.id,
        origin: entry.origin,
        state: 'disabled' as const,
        stateReasons: ['已禁用，位于禁用区'],
        installMode: entry.installMode,
        linkTarget: entry.linkTarget,
        contentHash: entry.contentHash,
        baselineHash: registry.scopes[item.scope.id]?.records[entry.name]?.baseline.contentHash,
        localModified: false,
        disabled: true,
        tracked: true,
        forked: false,
        lockManaged: true,
        description: '已禁用；可在此启用',
        category: '已禁用',
        skillPath: entry.origin.skillPath,
        updatedAt: entry.disabledAt,
      }
      item.skills.push(skill)
      existing.set(entry.name, skill)
    }

    const activeNames = new Set(item.skills.map(skill => skill.name))
    item.removed = buildRemovedViews(item.scope.id, registry.scopes[item.scope.id]?.records ?? {}, activeNames)
    item.groups = buildGroups(item.scope, item.skills)
    item.summary = summaryOf(item.skills)
  }
  return inventory
}
