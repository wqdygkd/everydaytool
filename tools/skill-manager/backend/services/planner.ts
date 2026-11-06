import type {
  ApplyPlanRequest,
  ApplyPlanResult,
  CheckUpdatesRequest,
  Scope,
  UndoPlanRequest,
  UndoPlanResult,
  UpdatePlan,
} from '../../../../shared/skill-manager.ts'
import type { PlanPaths } from './planner-core.ts'
import { resolveLayerPath } from '../../../../backend/utils/data-layers.ts'
import { getDefaultInstallPaths, getDefaultProjectInstallPaths, getDefaultSkillManagerSettingsPath } from './installer.ts'
import { applyUpdatePlanCore, createUpdatePlanCore, undoPlanCore } from './planner-core.ts'
import { scanInventory } from './scanner.ts'
import { readSkillManagerSettings } from './settings.ts'

function removePolicy(): 'trash' | 'keep' {
  return readSkillManagerSettings(getDefaultSkillManagerSettingsPath()).removePolicy
}

function globalPaths(): PlanPaths {
  return {
    ...getDefaultInstallPaths(),
    backupRoot: resolveLayerPath('config', 'skill-manager', 'lock-backups'),
    removePolicy: removePolicy(),
  }
}

function projectPaths(projectPath: string): PlanPaths {
  return { ...getDefaultProjectInstallPaths(projectPath), removePolicy: removePolicy() }
}

async function findScope(scopeId: string): Promise<Scope> {
  const inventory = await scanInventory()
  const scope = inventory.scopes.find(item => item.scope.id === scopeId)?.scope
  if (!scope) throw new Error(`找不到作用域：${scopeId}`)
  return scope
}

function pathsFor(scope: Scope): PlanPaths {
  if (scope.kind === 'project') {
    if (!scope.projectPath) throw new Error('项目路径缺失')
    return projectPaths(scope.projectPath)
  }
  return globalPaths()
}

export async function checkUpdates(request: CheckUpdatesRequest): Promise<UpdatePlan> {
  const scope = await findScope(request.scopeId)
  return createUpdatePlanCore(request, pathsFor(scope))
}

export function applyUpdatePlan(request: ApplyPlanRequest): Promise<ApplyPlanResult> {
  return applyUpdatePlanCore(request)
}

export async function undoLastPlan(request: UndoPlanRequest): Promise<UndoPlanResult> {
  const scope = await findScope(request.scopeId)
  return undoPlanCore(request, pathsFor(scope))
}
