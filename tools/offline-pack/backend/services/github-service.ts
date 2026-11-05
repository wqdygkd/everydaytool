// GitHub Releases / 分支 / 单文件解析：只处理公开仓库（不带 Token）。
// API 请求一律直连；加速代理只作用于下载 URL，由渲染层每条线路各传一个 base 上来。
import type {
  OfflinePackGithubAsset,
  OfflinePackGithubFileResult,
  OfflinePackGithubRefItem,
  OfflinePackGithubRefsResult,
  OfflinePackGithubRelease,
  OfflinePackGithubResolveResult,
} from '../../../../shared/offline-pack.ts'
import { githubRawUrl, parseGithubUrl } from '../../../../shared/offline-pack.ts'
import { fetchRaw } from '../utils/http.ts'

const API_BASE = 'https://api.github.com'
const MAX_RELEASES = 30
const MAX_REFS = 100
/** 更新日志截断长度：整段拉下来既费带宽也没人读 */
const MAX_BODY_LENGTH = 4000
/** 仓库解析结果缓存：匿名配额只有 60 次/小时，来回切区块不能重复扣 */
const CACHE_TTL_MS = 5 * 60_000

interface CacheEntry {
  at: number
  etag?: string
  /** 最近一次真实响应的配额信息：缓存命中时也要能显示「剩余 N 次」 */
  rate?: RateInfo
  data: unknown
}

const cache = new Map<string, CacheEntry>()

interface GithubAssetJson {
  id?: number
  name?: string
  size?: number
  download_count?: number
  content_type?: string
  digest?: string | null
  browser_download_url?: string
}

interface GithubReleaseJson {
  tag_name?: string
  name?: string | null
  published_at?: string | null
  prerelease?: boolean
  draft?: boolean
  body?: string | null
  assets?: GithubAssetJson[]
}

interface GithubRepoJson {
  description?: string | null
  stargazers_count?: number
  language?: string | null
  default_branch?: string
  pushed_at?: string | null
  archived?: boolean
}

interface GithubRefJson {
  name?: string
  commit?: { sha?: string }
}

interface GithubContentsJson {
  type?: string
  name?: string
  path?: string
  size?: number
}

interface RateInfo {
  rateRemaining?: number
  rateResetAt?: string
}

function apiHeaders(): Record<string, string> {
  return {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function rateInfo(res: Response): RateInfo {
  const remaining = res.headers.get('x-ratelimit-remaining')
  const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0)
  return {
    rateRemaining: remaining === null ? undefined : Number(remaining),
    rateResetAt: reset > 0 ? new Date(reset * 1000).toISOString() : undefined,
  }
}

function toHttpError(res: Response, notFoundMessage: string): Error {
  if (res.status === 404) return new Error(notFoundMessage)
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0)
    const when = reset > 0 ? new Date(reset * 1000).toLocaleTimeString() : ''
    return new Error(when
      ? `GitHub API 请求已达匿名配额（60 次/小时），请在 ${when} 后重试`
      : 'GitHub API 请求已达匿名配额（60 次/小时），请稍后重试')
  }
  return new Error(`GitHub API 返回 ${res.status}`)
}

/**
 * 带 ETag 的 GET：命中缓存直接返回；过期后发条件请求，304 只续期不扣配额。
 * GitHub 文档明确「返回 304 的条件请求不计入速率限制」，这对匿名 60 次/小时很关键。
 */
async function cachedJson<T>(
  key: string,
  url: string,
  map: (raw: unknown) => T,
  notFoundMessage: string,
): Promise<{ data: T } & RateInfo> {
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return { data: hit.data as T, ...hit.rate }
  }

  const headers = apiHeaders()
  if (hit?.etag) headers['If-None-Match'] = hit.etag

  const res = await fetchRaw(url, { headers })
  const rate = rateInfo(res)

  if (res.status === 304 && hit) {
    hit.at = now
    // 304 的响应头同样带 x-ratelimit-*，配额显示要跟着更新
    hit.rate = { ...hit.rate, ...rate }
    return { data: hit.data as T, ...hit.rate }
  }
  if (!res.ok) throw toHttpError(res, notFoundMessage)

  const data = map(await res.json())
  cache.set(key, { at: now, etag: res.headers.get('etag') ?? undefined, rate, data })
  return { data, ...rate }
}

function toAsset(raw: GithubAssetJson): OfflinePackGithubAsset | null {
  if (typeof raw.id !== 'number' || typeof raw.name !== 'string' || !raw.name) return null
  if (typeof raw.browser_download_url !== 'string') return null
  return {
    id: raw.id,
    name: raw.name,
    size: typeof raw.size === 'number' ? raw.size : 0,
    downloadCount: typeof raw.download_count === 'number' ? raw.download_count : 0,
    contentType: raw.content_type,
    digest: typeof raw.digest === 'string' && raw.digest ? raw.digest : undefined,
    browserDownloadUrl: raw.browser_download_url,
  }
}

function toRelease(raw: GithubReleaseJson): OfflinePackGithubRelease | null {
  if (typeof raw.tag_name !== 'string' || !raw.tag_name) return null
  const assets = (raw.assets ?? []).map(toAsset).filter((asset): asset is OfflinePackGithubAsset => asset !== null)
  return {
    tag: raw.tag_name,
    name: raw.name || raw.tag_name,
    publishedAt: raw.published_at ?? '',
    prerelease: raw.prerelease === true,
    body: raw.body ? raw.body.slice(0, MAX_BODY_LENGTH) : undefined,
    assets,
  }
}

/** 解析仓库 + Releases（含资产清单）。两请求各自缓存，配额只扣一次。 */
export async function resolveGithubReleases(input: string): Promise<OfflinePackGithubResolveResult> {
  const ref = parseGithubUrl(input)
  if (!ref) {
    throw new Error('无法识别该链接，示例：https://github.com/owner/repo 或 owner/repo')
  }

  const key = `${ref.owner}/${ref.repo}`.toLowerCase()

  // 仓库元信息只是锦上添花：失败不影响版本列表
  const repoPromise = cachedJson<GithubRepoJson>(
    `repo:${key}`,
    `${API_BASE}/repos/${ref.owner}/${ref.repo}`,
    raw => raw as GithubRepoJson,
    '仓库不存在（仅支持公开仓库）',
  ).catch(() => null)

  const releasesPromise = cachedJson<GithubReleaseJson[]>(
    `releases:${key}`,
    `${API_BASE}/repos/${ref.owner}/${ref.repo}/releases?per_page=${MAX_RELEASES}`,
    raw => (Array.isArray(raw) ? raw as GithubReleaseJson[] : []),
    '仓库不存在，或该仓库未发布 Release（仅支持公开仓库）',
  )

  const [repo, releasesRes] = await Promise.all([repoPromise, releasesPromise])

  const releases = releasesRes.data
    .filter(raw => raw.draft !== true)
    .map(toRelease)
    .filter((release): release is OfflinePackGithubRelease => release !== null)

  return {
    owner: ref.owner,
    repo: ref.repo,
    description: repo?.data.description ?? undefined,
    stars: repo?.data.stargazers_count,
    language: repo?.data.language ?? undefined,
    defaultBranch: repo?.data.default_branch || 'main',
    updatedAt: repo?.data.pushed_at ?? undefined,
    archived: repo?.data.archived === true,
    releases,
    rateRemaining: releasesRes.rateRemaining,
    rateResetAt: releasesRes.rateResetAt,
  }
}

/** 分支 + 标签清单：源码下载与单文件区都用 sha 寻址，避免带 `/` 的 ref 歧义 */
export async function resolveGithubRefs(owner: string, repo: string): Promise<OfflinePackGithubRefsResult> {
  const key = `${owner}/${repo}`.toLowerCase()

  const toRefItems = (raw: unknown): OfflinePackGithubRefItem[] => {
    if (!Array.isArray(raw)) return []
    return (raw as GithubRefJson[])
      .map(item => ({
        name: typeof item.name === 'string' ? item.name : '',
        sha: typeof item.commit?.sha === 'string' ? item.commit.sha : '',
      }))
      .filter(item => item.name && item.sha)
  }

  const [branches, tags] = await Promise.all([
    cachedJson<OfflinePackGithubRefItem[]>(
      `branches:${key}`,
      `${API_BASE}/repos/${owner}/${repo}/branches?per_page=${MAX_REFS}`,
      toRefItems,
      '仓库不存在（仅支持公开仓库）',
    ),
    cachedJson<OfflinePackGithubRefItem[]>(
      `tags:${key}`,
      `${API_BASE}/repos/${owner}/${repo}/tags?per_page=${MAX_REFS}`,
      toRefItems,
      '仓库不存在（仅支持公开仓库）',
    ),
  ])

  return {
    branches: branches.data,
    tags: tags.data,
    // 单页上限 100：到头了就让 UI 说明「还有更多」，别假装是全集
    branchesTruncated: branches.data.length >= MAX_REFS,
    tagsTruncated: tags.data.length >= MAX_REFS,
    rateRemaining: tags.rateRemaining ?? branches.rateRemaining,
    rateResetAt: tags.rateResetAt ?? branches.rateResetAt,
  }
}

/** 单文件解析：只取路径 / 大小 / raw 直链，不落文件内容 */
export async function resolveGithubFile(
  owner: string,
  repo: string,
  ref: string,
  filePath: string,
): Promise<OfflinePackGithubFileResult> {
  const path = filePath.trim().replace(/^\/+|\/+$/g, '')
  if (!path) throw new Error('请输入文件路径，例如 docs/README.md')
  if (!ref) throw new Error('请选择分支或标签')
  // 路径段不接受 `..`：会被 URL 解析器折叠，把请求带到别的 API 路径上
  if (path.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new Error('文件路径不能包含 . 或 .. 段')
  }

  // 路径与 ref 大小写敏感（GitHub 允许 LICENSE / license 并存），缓存键不能用小写
  const key = `file:${owner}/${repo}@${ref}/${path}`
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')

  const result = await cachedJson<GithubContentsJson>(
    key,
    `${API_BASE}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    raw => raw as GithubContentsJson,
    '文件不存在，请检查路径与分支',
  )

  const data = result.data
  if (Array.isArray(data)) throw new Error('这是一个目录，请给出具体文件路径')
  if (data.type !== 'file') throw new Error('该路径不是普通文件（可能是子模块或符号链接）')

  const resolvedPath = data.path || path
  return {
    owner,
    repo,
    ref,
    path: resolvedPath,
    name: data.name || resolvedPath.split('/').pop() || resolvedPath,
    size: typeof data.size === 'number' ? data.size : 0,
    downloadUrl: githubRawUrl(owner, repo, ref, resolvedPath),
    rateRemaining: result.rateRemaining,
    rateResetAt: result.rateResetAt,
  }
}
