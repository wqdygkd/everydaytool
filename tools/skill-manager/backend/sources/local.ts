import type { SourceCatalog, SourceCatalogEntry } from '../../../../shared/skill-manager.ts'
import type { ParsedSource } from './parse.ts'
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { hashSkillDirectory } from '../services/hash.ts'
import { parseSkillFrontmatter } from '../services/scanner.ts'
import { SourceResolutionError } from './errors.ts'

const SKILL_FILE = 'SKILL.md'
const DEFAULT_MAX_DEPTH = 5
const DEFAULT_MAX_SKILLS = 500
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.nuxt'])

export interface SkillDiscoveryOptions {
  maxDepth?: number
  maxSkills?: number
  rootSkillName?: string
  warnings?: string[]
}

/** 扫描一个本地目录；根目录有 SKILL.md 时视为单技能。 */
export async function discoverLocalSkills(root: string, options: SkillDiscoveryOptions = {}): Promise<SourceCatalogEntry[]> {
  const rootInfo = await stat(root).catch(() => null)
  if (!rootInfo?.isDirectory()) throw new SourceResolutionError('local-not-found', `本地目录不存在：${root}`)

  const rootFile = join(root, SKILL_FILE)
  const rootMarkdown = await readFile(rootFile, 'utf8').catch(() => null)
  if (rootMarkdown !== null) {
    const frontmatter = parseSkillFrontmatter(rootMarkdown)
    return [{
      name: frontmatter?.name?.trim() || options.rootSkillName || basename(root),
      skillPath: SKILL_FILE,
      description: frontmatter?.description,
      folderSha: await hashSkillDirectory(root),
    }]
  }

  const entries: SourceCatalogEntry[] = []
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxSkills = options.maxSkills ?? DEFAULT_MAX_SKILLS
  const warnings = options.warnings ?? []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || entries.length >= maxSkills) return
    const children = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const names = children.map(child => child.name)
    if (names.includes(SKILL_FILE)) {
      const markdown = await readFile(join(dir, SKILL_FILE), 'utf8').catch(() => null)
      if (markdown !== null) {
        const frontmatter = parseSkillFrontmatter(markdown)
        const skillPath = relative(root, join(dir, SKILL_FILE)).split(sep).join('/')
        entries.push({
          name: frontmatter?.name?.trim() || basename(dir),
          skillPath,
          description: frontmatter?.description,
          folderSha: await hashSkillDirectory(dir),
        })
      }
      if (entries.length >= maxSkills) return
    }

    for (const child of children) {
      if (!child.isDirectory() || child.name.startsWith('.') || SKIP_DIRS.has(child.name)) continue
      await walk(join(dir, child.name), depth + 1)
    }
  }

  await walk(root, 0)
  if (entries.length >= maxSkills) warnings.push(`技能数量超过 ${maxSkills}，目录列表已截断`)
  return entries.sort((a, b) => a.skillPath.localeCompare(b.skillPath))
}

export async function resolveLocalCatalog(parsed: ParsedSource): Promise<SourceCatalog> {
  if (!parsed.localPath) throw new SourceResolutionError('local-not-found', '本地来源缺少路径')
  const root = parsed.subpath ? resolve(parsed.localPath, parsed.subpath) : parsed.localPath
  const parent = resolve(parsed.localPath)
  const rel = relative(parent, root)
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
    throw new SourceResolutionError('invalid-subpath', '本地子路径超出来源目录')
  }

  const info = await lstat(root).catch(() => null)
  if (!info?.isDirectory()) throw new SourceResolutionError('local-not-found', `本地目录不存在：${root}`)

  const warnings: string[] = []
  let entries = await discoverLocalSkills(root, {
    rootSkillName: parsed.displayName,
    warnings,
  })
  if (parsed.skill) {
    entries = entries.filter(entry => entry.name === parsed.skill)
    if (entries.length === 0) {
      throw new SourceResolutionError('skill-not-found', `本地来源中找不到技能：${parsed.skill}`)
    }
  }

  return {
    sourceType: 'local',
    source: parsed.source,
    sourceUrl: parsed.sourceUrl,
    ref: parsed.ref,
    resolvedRef: 'local',
    displayName: parsed.displayName,
    host: parsed.host,
    rootSkill: entries.some(entry => entry.skillPath === SKILL_FILE),
    total: entries.length,
    entries,
    fetchedAt: new Date().toISOString(),
    warnings,
  }
}
