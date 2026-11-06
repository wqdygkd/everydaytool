import type { SourceCatalog, SourceCatalogEntry } from '../../../../shared/skill-manager.ts'
import type { ParsedSource } from './parse.ts'
import process from 'node:process'
import { SourceResolutionError } from './errors.ts'

interface GithubRepo {
  default_branch?: string
  private?: boolean
  archived?: boolean
  full_name?: string
}

interface GithubTreeEntry {
  path: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
}

interface GithubTree {
  sha: string
  truncated?: boolean
  tree: GithubTreeEntry[]
}

const API_BASE = 'https://api.github.com'
const SKILL_FILE = 'SKILL.md'

/** 解析 GitHub 仓库；公开库无需 token，私有库没有 token 时明确提示需要凭据。 */
export async function resolveGithubCatalog(parsed: ParsedSource, token = githubToken(), timeoutMs = 20_000): Promise<SourceCatalog> {
  const [owner, repo] = parsed.source.split('/')
  if (!owner || !repo) throw new SourceResolutionError('invalid-github-source', 'GitHub 来源缺少 owner/repo')

  const repoInfo = await githubJson<GithubRepo>(`/repos/${encodeSegment(owner)}/${encodeSegment(repo)}`, token, timeoutMs)
  const ref = parsed.ref || repoInfo.default_branch || 'main'
  const tree = await githubJson<GithubTree>(
    `/repos/${encodeSegment(owner)}/${encodeSegment(repo)}/git/trees/${encodeRef(ref)}?recursive=1`,
    token,
    timeoutMs,
  )
  if (tree.truncated) {
    throw new SourceResolutionError('tree-truncated', '仓库文件树过大，GitHub 返回了截断结果；请改用 git 来源')
  }

  const warnings: string[] = []
  if (repoInfo.archived) warnings.push('仓库已归档，仍可读取，但上游可能不再更新')

  const rootSkill = tree.tree.some(entry => entry.type === 'blob' && entry.path === SKILL_FILE)
  let entries: SourceCatalogEntry[]
  if (rootSkill) {
    entries = [{
      name: parsed.skill || repoInfo.full_name?.split('/').pop() || repo,
      skillPath: SKILL_FILE,
      folderSha: tree.sha,
    }]
  }
  else {
    entries = discoverGithubSkills(tree)
  }

  if (parsed.skill) {
    entries = entries.filter(entry => entry.name === parsed.skill)
    if (entries.length === 0) {
      throw new SourceResolutionError('skill-not-found', `仓库中找不到技能：${parsed.skill}`)
    }
  }
  if (entries.length === 0) {
    throw new SourceResolutionError('no-skills', '仓库中没有找到 SKILL.md；确认来源或 ref 是否正确')
  }

  return {
    sourceType: 'github',
    source: parsed.source,
    sourceUrl: parsed.sourceUrl,
    ref: parsed.ref,
    resolvedRef: ref,
    displayName: parsed.displayName,
    host: parsed.host,
    rootSkill: entries.length === 1 && entries[0].skillPath === SKILL_FILE,
    total: entries.length,
    entries,
    fetchedAt: new Date().toISOString(),
    warnings,
  }
}

function discoverGithubSkills(tree: GithubTree): SourceCatalogEntry[] {
  const directories = new Map<string, string>()
  for (const entry of tree.tree) {
    if (entry.type === 'tree') directories.set(entry.path, entry.sha)
  }

  const entries: SourceCatalogEntry[] = []
  for (const entry of tree.tree) {
    if (entry.type !== 'blob' || !entry.path.endsWith(`/${SKILL_FILE}`)) continue
    const skillPath = entry.path
    const segments = skillPath.split('/')
    if (segments.length > 6) continue
    if (segments.some(segment => segment === 'node_modules' || segment === '.git' || segment.startsWith('.'))) continue
    const folder = segments.slice(0, -1).join('/')
    entries.push({
      name: segments.at(-2) ?? folder,
      skillPath,
      folderSha: directories.get(folder),
    })
  }
  return entries.sort((a, b) => a.skillPath.localeCompare(b.skillPath))
}

async function githubJson<T>(path: string, token: string | undefined, timeoutMs: number): Promise<T> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'everydaytool-skill-manager',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
  }
  catch {
    throw new SourceResolutionError('github-unreachable', '无法连接 GitHub，请检查网络或代理')
  }

  if (!response.ok) {
    if (response.status === 404) {
      if (!token) throw new SourceResolutionError('auth-required', '需要凭据：私有仓库或仓库不存在，请配置 GitHub token')
      throw new SourceResolutionError('github-not-found', 'GitHub 仓库不存在，或当前 token 无权访问')
    }
    if (response.status === 401 || response.status === 403) {
      const remaining = response.headers.get('x-ratelimit-remaining')
      if (remaining === '0') throw new SourceResolutionError('github-rate-limit', 'GitHub API 已限流，请稍后重试')
      throw new SourceResolutionError('github-auth', 'GitHub 凭据无效或权限不足')
    }
    if (response.status === 429) throw new SourceResolutionError('github-rate-limit', 'GitHub API 已限流，请稍后重试')
    throw new SourceResolutionError('github-error', `GitHub API 请求失败（HTTP ${response.status}）`)
  }

  try {
    return await response.json() as T
  }
  catch {
    throw new SourceResolutionError('github-invalid-response', 'GitHub API 返回了无法解析的数据')
  }
}

function githubToken(): string | undefined {
  return process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || undefined
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

function encodeRef(ref: string): string {
  return ref.split('/').map(encodeSegment).join('/')
}
