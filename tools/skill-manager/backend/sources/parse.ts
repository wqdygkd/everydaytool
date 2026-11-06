import type { SkillSourceType } from '../../../../shared/skill-manager.ts'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SourceResolutionError } from './errors.ts'

export interface ParsedSource {
  sourceType: Exclude<SkillSourceType, 'node_modules' | 'well-known' | 'unknown'>
  /** 归一化后的来源标识；GitHub 为 owner/repo，本地为绝对路径。 */
  source: string
  sourceUrl?: string
  ref?: string
  skill?: string
  subpath?: string
  localPath?: string
  displayName: string
  host: string
}

interface SourceParts {
  value: string
  ref?: string
  subpath?: string
  skill?: string
}

const TRAILING_SKILL = /@([\w.-]+)$/
const GITHUB_SHORTHAND = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/
const WINDOWS_PATH = /^[a-z]:[\\/]/i

/** 解析安装输入；支持 owner/repo、GitHub URL、通用 git/TFS、本地目录。 */
export function parseSourceInput(raw: string, refOverride?: string): ParsedSource {
  const trimmed = raw.trim()
  if (!trimmed) throw new SourceResolutionError('empty-source', '请输入技能来源')
  if (trimmed.length > 2000) throw new SourceResolutionError('source-too-long', '来源过长')

  const parts = splitSource(trimmed)
  if (refOverride?.trim()) parts.ref = refOverride.trim()

  const github = parseGithub(parts)
  if (github) return github

  const local = parseLocal(parts)
  if (local) return local

  const git = parseGit(parts)
  if (git) return git

  throw new SourceResolutionError('unsupported-source', '无法识别来源；支持 owner/repo、GitHub URL、git URL 或本地目录')
}

function splitSource(input: string): SourceParts {
  let value = input
  let ref: string | undefined
  let subpath: string | undefined
  let skill: string | undefined

  const hashIndex = value.indexOf('#')
  if (hashIndex >= 0) {
    ref = value.slice(hashIndex + 1).trim() || undefined
    value = value.slice(0, hashIndex)
  }

  if (isHttpUrl(value) || value.startsWith('file://')) {
    try {
      const url = new URL(value)
      const version = url.searchParams.get('version')?.trim()
      if (version) ref = version
      const path = url.searchParams.get('path')?.trim()
      if (path) subpath = path
      url.search = ''
      url.hash = ''
      value = url.toString()
    }
    catch {
      throw new SourceResolutionError('invalid-url', 'URL 格式不正确')
    }
  }

  if (!value.startsWith('git@') && !value.includes('://')) {
    const match = value.match(TRAILING_SKILL)
    if (match) {
      skill = match[1]
      value = value.slice(0, -match[0].length)
    }
  }

  return { value, ref, subpath, skill }
}

function parseGithub(parts: SourceParts): ParsedSource | null {
  const shorthand = parts.value.match(GITHUB_SHORTHAND)
  if (shorthand && !parts.value.startsWith('git@')) {
    const owner = shorthand[1]
    const repo = shorthand[2]
    return githubResult(parts, owner, repo)
  }

  if (!isHttpUrl(parts.value)) return null
  let url: URL
  try {
    url = new URL(parts.value)
  }
  catch {
    return null
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null

  const segments = url.pathname.split('/').filter(Boolean).map(decodeSegment)
  if (segments.length < 2) throw new SourceResolutionError('invalid-github-url', 'GitHub URL 缺少 owner/repo')
  const owner = segments[0]
  const repo = segments[1].replace(/\.git$/, '')
  if (segments[2] === 'tree' && segments[3]) {
    parts.ref = parts.ref ?? segments[3]
    const treePath = segments.slice(4).join('/')
    if (treePath) parts.subpath = treePath
  }
  return githubResult(parts, owner, repo)
}

function githubResult(parts: SourceParts, owner: string, repo: string): ParsedSource {
  const source = `${owner}/${repo}`
  return {
    sourceType: 'github',
    source,
    sourceUrl: `https://github.com/${source}`,
    ref: normalizeRef(parts.ref),
    skill: parts.skill,
    subpath: normalizeSubpath(parts.subpath),
    displayName: source,
    host: 'github.com',
  }
}

function parseGit(parts: SourceParts): ParsedSource | null {
  const value = parts.value
  const isGitUrl = value.startsWith('git@')
    || value.startsWith('ssh://')
    || value.startsWith('git://')
    || value.includes('/_git/')
    || value.startsWith('file://')
    || /\.git$/i.test(value)
    || (isHttpUrl(value) && !isGithubHost(value))
  if (!isGitUrl) return null

  let host = 'git'
  let repoName = value.replace(/\/+$/, '').replace(/\.git$/i, '').split(/[/:]/).pop() ?? value
  if (isHttpUrl(value)) {
    try {
      const url = new URL(value)
      host = url.hostname
      const segments = url.pathname.split('/').filter(Boolean)
      repoName = decodeSegment(segments.at(-1) ?? '').replace(/\.git$/i, '') || host
    }
    catch {
      // 保留上面从字符串推断的名称
    }
  }
  else if (value.startsWith('git@')) {
    const hostMatch = value.match(/^git@([^:]+):/)
    if (hostMatch) host = hostMatch[1]
  }

  return {
    sourceType: 'git',
    source: value,
    sourceUrl: value,
    ref: normalizeRef(parts.ref),
    skill: parts.skill,
    subpath: normalizeSubpath(parts.subpath),
    displayName: repoName || 'git 仓库',
    host,
  }
}

function parseLocal(parts: SourceParts): ParsedSource | null {
  const value = parts.value
  const looksLocal = value.startsWith('~')
    || value.startsWith('.')
    || value.startsWith('/')
    || (value.startsWith('file://') && !/\.git\/?$/i.test(value))
    || WINDOWS_PATH.test(value)
  if (!looksLocal) return null

  let localPath: string
  try {
    if (value.startsWith('file://')) localPath = fileURLToPath(value)
    else if (value === '~') localPath = homedir()
    else if (value.startsWith('~/')) localPath = resolve(homedir(), value.slice(2))
    else localPath = resolve(value)
  }
  catch {
    throw new SourceResolutionError('invalid-local-path', '本地路径格式不正确')
  }

  return {
    sourceType: 'local',
    source: localPath,
    sourceUrl: `file://${localPath}`,
    ref: normalizeRef(parts.ref),
    skill: parts.skill,
    subpath: normalizeSubpath(parts.subpath),
    localPath,
    displayName: basename(localPath) || localPath,
    host: '本地',
  }
}

function normalizeRef(value: string | undefined): string | undefined {
  if (!value) return undefined
  let ref = value.trim()
  if (!ref) return undefined
  ref = ref.replace(/^refs\/(?:heads|tags)\//, '')
  if (/^G[BT]\w+/.test(ref)) return ref.slice(2)
  if (/^GC\w+/.test(ref)) return ref.slice(2)
  return ref
}

function normalizeSubpath(value: string | undefined): string | undefined {
  if (!value) return undefined
  const decoded = decodeSegment(value)
  const segments = decoded.split('/').filter(Boolean)
  if (segments.some(segment => segment === '..' || segment === '.')) {
    throw new SourceResolutionError('invalid-subpath', '子路径不能包含 . 或 ..')
  }
  return segments.length > 0 ? segments.join('/') : undefined
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  }
  catch {
    return value
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function isGithubHost(value: string): boolean {
  try {
    const host = new URL(value).hostname
    return host === 'github.com' || host === 'www.github.com'
  }
  catch {
    return false
  }
}

/** 仅为外部测试/调试保留：把本地路径展开为绝对路径。 */
export function expandLocalPath(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2))
  return resolve(value)
}
