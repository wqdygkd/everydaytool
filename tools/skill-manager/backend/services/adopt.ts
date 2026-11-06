import type { AdoptRequest, AdoptResult } from '../../../../shared/skill-manager.ts'
import { adoptSkillCore } from './adopt-core.ts'
import { getDefaultHistoryPath, getDefaultLockBackupRoot, getDefaultRegistryPath } from './installer.ts'
import { scanInventory } from './scanner.ts'

export async function adoptSkill(request: AdoptRequest): Promise<AdoptResult> {
  const inventory = await scanInventory()
  const scope = inventory.scopes.find(item => item.scope.id === request.scopeId)?.scope
  if (!scope) throw new Error(`未找到作用域：${request.scopeId}`)
  return adoptSkillCore(request, scope, {
    registryPath: getDefaultRegistryPath(),
    historyPath: getDefaultHistoryPath(),
    backupRoot: getDefaultLockBackupRoot(),
  })
}
