import type {
  InstalledSkill,
  RepoCatalog,
  RepoCatalogEntry,
  SourceCatalog,
  SourceCatalogEntry,
} from '../../../../shared/skill-manager.ts'
import { isAbsolute, join } from 'node:path'
import { scanInventory } from '../services/scanner.ts'
import { SourceResolutionError } from './errors.ts'
import { resolveGitCatalog } from './git.ts'
import { resolveGithubCatalog } from './github.ts'
import { resolveLocalCatalog } from './local.ts'
import { parseSourceInput } from './parse.ts'

export interface SourceAuth {
  token?: string
  timeoutMs?: number
}

type SourceAuthProvider = (parsed: ReturnType<typeof parseSourceInput>) => Promise<SourceAuth | undefined> | SourceAuth | undefined

let sourceAuthProvider: SourceAuthProvider | undefined

/** 由 Electron 层注入：按 host 读取 secret-box 中的 PAT 与设置里的网络超时。 */
export function configureSourceAuthProvider(provider: SourceAuthProvider | undefined): void {
  sourceAuthProvider = provider
}

/** 统一来源解析入口：GitHub / 通用 git / 本地目录；不下载、不安装。 */
export async function resolveSource(input: string, ref?: string): Promise<SourceCatalog> {
  const parsed = parseSourceInput(input, ref)
  const auth = await sourceAuthProvider?.(parsed)
  const catalog = parsed.sourceType === 'github'
    ? await resolveGithubCatalog(parsed, auth?.token, auth?.timeoutMs)
    : parsed.sourceType === 'git'
      ? await resolveGitCatalog(parsed, auth)
      : await resolveLocalCatalog(parsed)
  if (parsed.sourceType !== 'local' && parsed.subpath) filterSubpath(catalog, parsed.subpath)
  warnDuplicateNames(catalog)
  return catalog
}

/** 已安装仓库组的目录视图；只返回目录与本地状态，不触发安装。 */
export async function getRepoCatalog(scopeId: string, groupKey: string): Promise<RepoCatalog> {
  const inventory = await scanInventory()
  const scope = inventory.scopes.find(item => item.scope.id === scopeId)
  if (!scope) throw new SourceResolutionError('scope-not-found', '找不到对应的技能作用域')
  const group = scope.groups.find(item => item.key === groupKey)
  if (!group) throw new SourceResolutionError('group-not-found', '找不到对应的仓库组')
  if (group.orphan) throw new SourceResolutionError('orphan-group', '未托管技能没有远端来源，不能刷新目录')

  const input = sourceInputForGroup(group.origin.sourceType, group.origin.source, group.origin.sourceUrl, scope.scope.projectPath)
  const catalog = await resolveSource(input, group.origin.ref ?? undefined)
  const used = new Set<string>()
  const entries: RepoCatalogEntry[] = catalog.entries.map((entry) => {
    const local = matchLocalSkill(group.skills, entry, used)
    if (local) used.add(local.key)
    return {
      ...entry,
      localState: local?.state,
      selected: Boolean(local),
      updateAvailable: false,
    }
  })

  return {
    ...catalog,
    groupKey,
    entries,
  }
}

function filterSubpath(catalog: SourceCatalog, subpath: string): void {
  const prefix = subpath.replace(/^\/+|\/+$/g, '')
  if (!prefix) return
  const entries = catalog.entries.filter(entry => entry.skillPath === `${prefix}/SKILL.md` || entry.skillPath.startsWith(`${prefix}/`))
  if (entries.length === 0) throw new SourceResolutionError('no-skills', `来源子路径下没有找到 SKILL.md：${prefix}`)
  catalog.entries = entries
  catalog.total = entries.length
  catalog.rootSkill = false
}

function warnDuplicateNames(catalog: SourceCatalog): void {
  const seen = new Map<string, number>()
  for (const entry of catalog.entries) seen.set(entry.name, (seen.get(entry.name) ?? 0) + 1)
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name)
  if (duplicates.length > 0 && !catalog.warnings.some(item => item.includes('同名技能'))) {
    catalog.warnings.push(`存在同名技能：${duplicates.join('、')}；安装时需按路径确认`)
  }
}

function sourceInputForGroup(
  sourceType: string,
  source: string,
  sourceUrl: string | undefined,
  projectPath: string | undefined,
): string {
  if (sourceType === 'github') return source
  if (sourceType === 'git') return sourceUrl ?? source
  if (sourceType === 'local') {
    if (isAbsolute(source)) return source
    return projectPath ? join(projectPath, source) : source
  }
  throw new SourceResolutionError('unsupported-source-type', `暂不支持 ${sourceType} 来源`)
}

function matchLocalSkill(
  skills: InstalledSkill[],
  entry: SourceCatalogEntry,
  used: Set<string>,
): InstalledSkill | undefined {
  const exact = skills.find(skill => !used.has(skill.key) && skill.skillPath === entry.skillPath)
  if (exact) return exact
  const byName = skills.filter(skill => !used.has(skill.key) && (skill.name === entry.name || skill.dirName === entry.name))
  return byName.length === 1 ? byName[0] : undefined
}
