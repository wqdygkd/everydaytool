import type { DeleteSkillRequest, DeleteSkillResult } from '../../../../shared/skill-manager.ts'
import { deleteSkillCore } from './delete-skill-core.ts'
import { getDefaultHistoryPath, getDefaultRegistryPath, getDefaultTrashRoot } from './installer.ts'
import { scanInventory } from './scanner.ts'

export async function deleteSkill(request: DeleteSkillRequest): Promise<DeleteSkillResult> {
  const inventory = await scanInventory()
  const scope = inventory.scopes.find(item => item.scope.id === request.scopeId)
  if (!scope) throw new Error(`未找到作用域：${request.scopeId}`)
  const skill = scope.skills.find(item => item.name === request.name)
  if (!skill) throw new Error(`未找到技能：${request.name}`)
  return deleteSkillCore(request, scope.scope, skill, {
    trashRoot: getDefaultTrashRoot(),
    registryPath: getDefaultRegistryPath(),
    historyPath: getDefaultHistoryPath(),
  })
}
