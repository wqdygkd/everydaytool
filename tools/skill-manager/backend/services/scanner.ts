import type {
  GlobalLockEntry,
  InstalledSkill,
  Inventory,
  ProjectLockEntry,
  ProjectRecord,
  ReadSkillResult,
  RepoGroupView,
  ScanDiagnostic,
  ScanSummary,
  Scope,
  ScopeInventory,
  SkillFileNode,
  SkillManagerOverview,
  SkillOrigin,
  SkillSourceType,
  SkillState,
} from '../../../../shared/skill-manager.ts'
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, readlink, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'
import { getGlobalLockPath, readGlobalLock } from '../locks/global-lock.ts'
import { getProjectLockPath, readProjectLock } from '../locks/project-lock.ts'

const SKILL_FILE = 'SKILL.md'
const MAX_PREVIEW_FILES = 200
const MAX_PREVIEW_DEPTH = 4
const FRONTMATTER_LIMIT = 8192

type AnyLockEntry = ProjectLockEntry | GlobalLockEntry

interface ScanEntry {
  skill: InstalledSkill
}

interface ScanDirResult {
  entries: ScanEntry[]
  names: Set<string>
  diagnostics: ScanDiagnostic[]
}

export interface SkillFrontmatter {
  name?: string
  description?: string
  category?: string
}

export function parseSkillFrontmatter(markdown: string): SkillFrontmatter | null {
  const source = markdown.replace(/^\uFEFF/, '')
  const lines = source.slice(0, FRONTMATTER_LIMIT).split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null

  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (close < 0) return null

  const result: SkillFrontmatter = {}
  for (const line of lines.slice(1, close)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    if (!/^[a-z][\w-]*$/i.test(key)) continue
    const value = stripYamlQuotes(line.slice(colon + 1).trim())
    if (key === 'name') result.name = value
    if (key === 'description') result.description = value
    if (key === 'category') result.category = value
  }
  return result
}

function stripYamlQuotes(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))) {
    return value.slice(1, -1)
  }
  return value
}

function normalizeSourceType(value: string): SkillSourceType {
  if (value === 'github' || value === 'git' || value === 'local' || value === 'node_modules' || value === 'well-known') {
    return value
  }
  return 'unknown'
}

function originFromLock(entry: AnyLockEntry): SkillOrigin {
  return {
    sourceType: normalizeSourceType(entry.sourceType),
    source: entry.source,
    sourceUrl: entry.sourceUrl,
    ref: entry.ref ?? null,
    skillPath: entry.skillPath,
  }
}

function originKey(origin: SkillOrigin): string {
  return `${origin.sourceType}:${origin.source}@${origin.ref ?? ''}`
}

function displayName(origin: SkillOrigin): string {
  if (origin.sourceType === 'unknown') return '未托管'
  if (origin.sourceType === 'local') return basename(origin.source) || origin.source
  return origin.source
}

function hostOf(origin: SkillOrigin): string {
  if (origin.sourceType === 'github') return 'github.com'
  if (origin.sourceType === 'local') return '本地'
  if (origin.sourceType === 'unknown') return '来源未知'
  if (origin.sourceType === 'node_modules') return 'node_modules'
  if (origin.sourceType === 'well-known') return 'well-known'
  try {
    return new URL(origin.sourceUrl || origin.source).host || 'git'
  } catch {
    return 'git'
  }
}

function isSafeName(name: string): boolean {
  return Boolean(name)
    && name !== '.'
    && name !== '..'
    && !name.includes('/')
    && !name.includes('\\')
    && !name.startsWith('.')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

async function hashPath(path: string): Promise<string> {
  return createHash('sha256').update(path).digest('hex').slice(0, 12)
}

let projectRegistryProvider: (() => ProjectRecord[]) | undefined

/** IPC 层注入项目登记表；测试不注入时只扫描 global 与当前工作目录。 */
export function configureProjectRegistryProvider(provider: (() => ProjectRecord[]) | undefined): void {
  projectRegistryProvider = provider
}

export async function buildScopes(): Promise<Scope[]> {
  const globalSkillsDir = join(homedir(), '.agents', 'skills')
  const globalLockPath = getGlobalLockPath()
  const scopes: Scope[] = [{
    id: 'global',
    kind: 'global',
    label: '全局',
    skillsDir: globalSkillsDir,
    lockPath: globalLockPath,
    lockState: 'missing',
  }]

  const seen = new Set<string>()
  const addProject = async (inputPath: string, label?: string, force = false): Promise<void> => {
    let projectPath = resolve(inputPath)
    try {
      projectPath = await realpath(projectPath)
    } catch {
      return
    }
    if (seen.has(projectPath)) return
    const skillsDir = join(projectPath, '.agents', 'skills')
    const lockPath = getProjectLockPath(projectPath)
    if (!force && !(await pathExists(skillsDir)) && !(await pathExists(lockPath))) return
    seen.add(projectPath)
    scopes.push({
      id: `project:${await hashPath(projectPath)}`,
      kind: 'project',
      label: label || basename(projectPath) || projectPath,
      skillsDir,
      lockPath,
      projectPath,
      lockState: 'missing',
    })
  }

  const registered = projectRegistryProvider?.() ?? []
  for (const project of registered) {
    if (project.enabled !== false) await addProject(project.path, project.name, true)
  }
  await addProject(process.cwd())
  return scopes
}

async function scanEntry(
  scope: Scope,
  dirName: string,
  lockEntry: AnyLockEntry | undefined,
): Promise<ScanEntry> {
  const absPath = join(scope.skillsDir, dirName)
  const diagnostics: ScanDiagnostic[] = []
  const reasons: string[] = []
  let installMode: 'copy' | 'symlink' = 'copy'
  let linkTarget: string | undefined
  let canRead = true
  let state: SkillState = lockEntry ? 'ok' : 'orphan'

  const entryStat = await lstat(absPath)
  if (entryStat.isSymbolicLink()) {
    installMode = 'symlink'
    try {
      linkTarget = await readlink(absPath)
    } catch {
      canRead = false
      state = 'invalid'
      reasons.push('无法读取链接目标')
    }

    try {
      const targetStat = await stat(absPath)
      if (!targetStat.isDirectory()) {
        canRead = false
        state = 'invalid'
        reasons.push('链接目标不是目录')
      }
    } catch {
      canRead = false
      state = 'invalid'
      reasons.push('链接已断开')
    }
  } else if (!entryStat.isDirectory()) {
    canRead = false
    state = 'invalid'
    reasons.push('不是目录')
  }

  const markdownPath = join(absPath, SKILL_FILE)
  let markdown: string | undefined
  let frontmatter: SkillFrontmatter | null = null
  if (canRead) {
    try {
      markdown = await readFile(markdownPath, 'utf8')
      frontmatter = parseSkillFrontmatter(markdown)
      if (!frontmatter) {
        state = 'invalid'
        reasons.push('SKILL.md 缺少 frontmatter')
      }
    } catch {
      state = 'invalid'
      reasons.push('缺少 SKILL.md')
    }
  }

  if (!lockEntry && state !== 'invalid') {
    state = installMode === 'symlink' ? 'linked' : 'orphan'
  }
  if (lockEntry && !lockEntry.skillPath && state !== 'invalid') {
    state = 'legacy'
    reasons.push('锁记录缺少 skillPath')
  }

  if (state === 'invalid') {
    diagnostics.push({
      level: 'warning',
      code: 'skill-invalid',
      scopeId: scope.id,
      name: dirName,
      message: `${dirName}：${reasons.join('；')}`,
    })
  }

  const origin = lockEntry ? originFromLock(lockEntry) : { sourceType: 'unknown' as const, source: 'unknown' }
  return {
    skill: {
      key: `${scope.id}:${dirName}`,
      name: dirName,
      dirName,
      scopeId: scope.id,
      origin,
      state,
      stateReasons: reasons,
      installMode,
      linkTarget,
      localModified: false,
      disabled: false,
      tracked: Boolean(lockEntry),
      forked: false,
      lockManaged: Boolean(lockEntry),
      description: frontmatter?.description || (state === 'invalid' ? reasons.join('；') : '暂无描述'),
      category: frontmatter?.category || '未分类',
      skillPath: lockEntry?.skillPath ?? `${dirName}/SKILL.md`,
      frontmatterName: frontmatter?.name,
    },
  }
}

async function scanSkillsDir(scope: Scope, lockEntries: Record<string, AnyLockEntry>): Promise<ScanDirResult> {
  const entries: ScanEntry[] = []
  const names = new Set<string>()
  const diagnostics: ScanDiagnostic[] = []

  let dirEntries
  try {
    dirEntries = await readdir(scope.skillsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      diagnostics.push({
        level: 'warning',
        code: 'skills-dir-unreadable',
        scopeId: scope.id,
        message: `无法读取技能目录：${(error as Error).message}`,
      })
    }
    return { entries, names, diagnostics }
  }

  for (const dirEntry of dirEntries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (dirEntry.name.startsWith('.') || dirEntry.name === 'node_modules') continue
    const absPath = join(scope.skillsDir, dirEntry.name)
    const lstatResult = await lstat(absPath)
    if (!lstatResult.isDirectory() && !lstatResult.isSymbolicLink()) {
      diagnostics.push({
        level: 'info',
        code: 'ignored-file',
        scopeId: scope.id,
        name: dirEntry.name,
        message: `忽略非目录条目：${dirEntry.name}`,
      })
      continue
    }

    const scanned = await scanEntry(scope, dirEntry.name, lockEntries[dirEntry.name])
    entries.push(scanned)
    names.add(dirEntry.name)
  }

  return { entries, names, diagnostics }
}

export function summaryOf(skills: InstalledSkill[]): ScanSummary {
  const count = (state: SkillState) => skills.filter(skill => skill.state === state).length
  const missing = count('missing')
  const update = count('update-available')
  const modified = count('modified')
  const invalid = count('invalid')
  return {
    total: skills.length,
    onDisk: skills.filter(skill => skill.state !== 'missing').length,
    tracked: skills.filter(skill => skill.tracked).length,
    untracked: skills.filter(skill => !skill.tracked).length,
    ok: count('ok'),
    update,
    modified,
    missing,
    orphan: count('orphan'),
    linked: count('linked'),
    invalid,
    disabled: count('disabled'),
    issueCount: update + modified + missing + invalid + count('removed-upstream'),
  }
}

export function buildGroups(scope: Scope, skills: InstalledSkill[]): RepoGroupView[] {
  const groups = new Map<string, RepoGroupView>()

  for (const skill of skills) {
    const orphan = !skill.tracked
    const key = orphan ? `orphan:${scope.id}` : originKey(skill.origin)
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        scopeId: scope.id,
        origin: {
          sourceType: skill.origin.sourceType,
          source: skill.origin.source,
          ref: skill.origin.ref,
          sourceUrl: skill.origin.sourceUrl,
        },
        displayName: displayName(skill.origin),
        host: hostOf(skill.origin),
        orphan,
        skills: [],
        counts: {
          remoteTotal: 0,
          selected: 0,
          installed: 0,
          ok: 0,
          update: 0,
          modified: 0,
          removed: 0,
          missing: 0,
          orphan: 0,
          linked: 0,
          invalid: 0,
          disabled: 0,
        },
      }
      groups.set(key, group)
    }
    group.skills.push(skill)
  }

  for (const group of groups.values()) {
    group.skills.sort((a, b) => a.name.localeCompare(b.name))
    group.counts.remoteTotal = group.skills.length
    group.counts.selected = group.skills.filter(skill => skill.tracked).length
    group.counts.installed = group.skills.filter(skill => skill.state !== 'missing' && skill.state !== 'disabled' && skill.state !== 'disabled-drift').length
    group.counts.ok = group.skills.filter(skill => skill.state === 'ok').length
    group.counts.update = group.skills.filter(skill => skill.state === 'update-available').length
    group.counts.modified = group.skills.filter(skill => skill.state === 'modified').length
    group.counts.removed = group.skills.filter(skill => skill.state === 'removed-upstream').length
    group.counts.missing = group.skills.filter(skill => skill.state === 'missing').length
    group.counts.orphan = group.skills.filter(skill => skill.state === 'orphan').length
    group.counts.linked = group.skills.filter(skill => skill.state === 'linked').length
    group.counts.invalid = group.skills.filter(skill => skill.state === 'invalid').length
    group.counts.disabled = group.skills.filter(skill => skill.state === 'disabled' || skill.state === 'disabled-drift').length
  }

  return [...groups.values()].sort((a, b) => {
    if (a.orphan !== b.orphan) return a.orphan ? 1 : -1
    return a.displayName.localeCompare(b.displayName)
  })
}

async function scanScope(scope: Scope): Promise<ScopeInventory> {
  const diagnostics: ScanDiagnostic[] = []
  const lockResult = scope.kind === 'global'
    ? await readGlobalLock(scope.lockPath)
    : await readProjectLock(scope.projectPath || process.cwd())

  if (!lockResult.ok) {
    scope.lockState = lockResult.reason === 'unsupported' ? 'unsupported' : 'invalid'
    diagnostics.push({
      level: 'warning',
      code: `lock-${lockResult.reason}`,
      scopeId: scope.id,
      message: lockResult.message,
    })
  } else {
    scope.lockState = lockResult.exists ? 'ok' : 'missing'
    if (lockResult.ok && typeof lockResult.data.version === 'number') {
      scope.lockVersion = lockResult.data.version
    }
  }

  const lockEntries = lockResult.ok
    ? lockResult.data.skills as Record<string, AnyLockEntry>
    : {}
  const scanned = await scanSkillsDir(scope, lockEntries)
  diagnostics.push(...scanned.diagnostics)

  for (const [name, lockEntry] of Object.entries(lockEntries)) {
    if (scanned.names.has(name)) continue
    diagnostics.push({
      level: 'warning',
      code: 'lock-missing-dir',
      scopeId: scope.id,
      name,
      message: `${name}：锁记录存在，但目录不存在`,
    })
    scanned.entries.push({
      skill: {
        key: `${scope.id}:${name}`,
        name,
        dirName: name,
        scopeId: scope.id,
        origin: originFromLock(lockEntry),
        state: 'missing',
        stateReasons: ['锁记录存在，但目录不存在'],
        installMode: 'copy',
        localModified: false,
        disabled: false,
        tracked: true,
        forked: false,
        lockManaged: true,
        description: '锁记录存在，但目录不存在',
        category: '未分类',
        skillPath: lockEntry.skillPath,
      },
    })
  }

  const skills = scanned.entries.map(entry => entry.skill)
  return {
    scope,
    groups: buildGroups(scope, skills),
    skills,
    removed: [],
    diagnostics,
    summary: summaryOf(skills),
  }
}

export async function scanInventory(): Promise<Inventory> {
  const scopes = await buildScopes()
  const inventories: ScopeInventory[] = []
  for (const scope of scopes) {
    inventories.push(await scanScope(scope))
  }
  return {
    scannedAt: new Date().toISOString(),
    scopes: inventories,
  }
}

export function toOverview(inventory: Inventory): SkillManagerOverview {
  return {
    scannedAt: inventory.scannedAt,
    totalSkills: inventory.scopes.reduce((sum, scope) => sum + scope.summary.total, 0),
    issueCount: inventory.scopes.reduce((sum, scope) => sum + scope.summary.issueCount, 0),
    scopes: inventory.scopes.map(scope => ({
      scope: scope.scope,
      summary: scope.summary,
      groupCount: scope.groups.length,
    })),
  }
}

async function readTree(
  root: string,
  current: string,
  depth: number,
  state: { count: number, truncated: boolean },
): Promise<SkillFileNode[]> {
  if (depth > MAX_PREVIEW_DEPTH || state.count >= MAX_PREVIEW_FILES) {
    state.truncated = true
    return []
  }

  const dirPath = current ? join(root, current) : root
  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const nodes: SkillFileNode[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    if (state.count >= MAX_PREVIEW_FILES) {
      state.truncated = true
      break
    }
    const relPath = current ? `${current}/${entry.name}` : entry.name
    const absPath = join(root, relPath)
    const entryStat = await lstat(absPath)
    state.count += 1
    if (entryStat.isSymbolicLink()) {
      nodes.push({ name: entry.name, path: relPath, type: 'link' })
    } else if (entryStat.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'dir',
        children: await readTree(root, relPath, depth + 1, state),
      })
    } else {
      nodes.push({ name: entry.name, path: relPath, type: 'file', size: entryStat.size })
    }
  }
  return nodes
}

export async function readSkill(scopeId: string, name: string): Promise<ReadSkillResult> {
  if (!isSafeName(name)) throw new Error('技能名称非法')
  const scopes = await buildScopes()
  const scope = scopes.find(item => item.id === scopeId)
  if (!scope) throw new Error('作用域不存在')

  const absPath = join(scope.skillsDir, name)
  const entryStat = await lstat(absPath)
  if (entryStat.isSymbolicLink()) {
    try {
      const targetStat = await stat(absPath)
      if (!targetStat.isDirectory()) throw new Error('链接目标不是目录')
    } catch (error) {
      if (error instanceof Error && error.message === '链接目标不是目录') throw error
      throw new Error('技能链接已断开')
    }
  } else if (!entryStat.isDirectory()) {
    throw new Error('技能不是目录')
  }

  const markdown = await readFile(join(absPath, SKILL_FILE), 'utf8')
  const treeState = { count: 0, truncated: false }
  const files = await readTree(absPath, '', 0, treeState)
  return { name, markdown, files, truncated: treeState.truncated }
}

export { scanScope }
