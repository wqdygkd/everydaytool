import type { SourceCatalog, SourceCatalogEntry } from '../../../../shared/skill-manager.ts'
import type { ParsedSource } from './parse.ts'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { SourceResolutionError } from './errors.ts'
import { discoverLocalSkills } from './local.ts'

const execFileAsync = promisify(execFile)
const SKILL_FILE = 'SKILL.md'
const GIT_TIMEOUT = 60_000

export interface GitAuth {
  token?: string
  timeoutMs?: number
}

interface RemoteInfo {
  headRef?: string
  headSha?: string
  ref?: string
}

/** 通用 git / TFS 来源：ls-remote 解析 ref，浅克隆到临时目录后只读扫描。 */
export async function resolveGitCatalog(parsed: ParsedSource, auth: GitAuth = {}): Promise<SourceCatalog> {
  const remote = await lsRemote(parsed.source, parsed.ref, auth)
  const resolvedRef = parsed.ref || remote.headRef || 'HEAD'
  const dir = await mkdtemp(join(tmpdir(), 'edt-skill-catalog-'))
  try {
    await cloneGitSource(parsed, dir, auth)

    const warnings: string[] = []
    if (parsed.source.startsWith('http://')) {
      warnings.push('来源使用 HTTP：PAT 可能以明文传输，建议改用 HTTPS；仅内网必要时使用只读最小权限令牌')
    }
    let entries = await discoverLocalSkills(dir, {
      rootSkillName: parsed.displayName,
      warnings,
    })
    if (parsed.skill) {
      entries = entries.filter(entry => entry.name === parsed.skill)
      if (entries.length === 0) {
        throw new SourceResolutionError('skill-not-found', `仓库中找不到技能：${parsed.skill}`)
      }
    }
    entries = await withFolderShas(dir, entries)

    const commitSha = await revParse(dir, 'HEAD').catch(() => undefined)
    return {
      sourceType: 'git',
      source: parsed.source,
      sourceUrl: parsed.sourceUrl,
      ref: parsed.ref,
      resolvedRef,
      commitSha,
      displayName: parsed.displayName,
      host: parsed.host,
      rootSkill: entries.length === 1 && entries[0].skillPath === SKILL_FILE,
      total: entries.length,
      entries,
      fetchedAt: new Date().toISOString(),
      warnings,
    }
  }
  finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

async function lsRemote(url: string, requestedRef: string | undefined, auth: GitAuth): Promise<RemoteInfo> {
  const args = requestedRef
    ? ['ls-remote', url, requestedRef, `refs/heads/${requestedRef}`, `refs/tags/${requestedRef}`]
    : ['ls-remote', '--symref', url, 'HEAD']
  const output = await runGit(args, auth.timeoutMs ?? 30_000, auth.token)
  const lines = output.split(/\r?\n/).filter(Boolean)

  if (requestedRef) {
    const wanted = new Set([requestedRef, `refs/heads/${requestedRef}`, `refs/tags/${requestedRef}`])
    const line = lines.find((item) => {
      const refName = item.split('\t')[1]
      return refName ? wanted.has(refName.replace(/\^\{\}$/, '')) : false
    })
    const sha = line?.split('\t')[0]
    if (!sha) throw new SourceResolutionError('git-ref-not-found', `找不到 git ref：${requestedRef}`)
    return { ref: requestedRef, headSha: sha }
  }

  let headRef: string | undefined
  let headSha: string | undefined
  for (const line of lines) {
    const [left, right] = line.split('\t')
    if (right !== 'HEAD') continue
    if (left?.startsWith('ref: ')) headRef = left.slice(5).replace(/^refs\/heads\//, '')
    else if (/^[\da-f]{40}$/i.test(left ?? '')) headSha = left
  }
  return { headRef, headSha }
}

async function runGit(args: string[], timeout: number, token?: string): Promise<string> {
  let askpassDir: string | undefined
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
  }
  if (token) {
    askpassDir = await mkdtemp(join(tmpdir(), 'edt-git-askpass-'))
    const askpass = join(askpassDir, 'askpass.sh')
    await writeFile(askpass, '#!/bin/sh\ncase "$1" in\n  Username*) printf \'%s\\n\' "$EDT_GIT_USERNAME" ;;\n  *) printf \'%s\\n\' "$EDT_GIT_TOKEN" ;;\nesac\n', 'utf8')
    await chmod(askpass, 0o700)
    env.GIT_ASKPASS = askpass
    env.EDT_GIT_TOKEN = token
    env.EDT_GIT_USERNAME = 'oauth2'
  }
  try {
    const { stdout } = await execFileAsync('git', args, {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      env,
    })
    return stdout
  }
  catch (error) {
    throw mapGitError(error)
  }
  finally {
    if (askpassDir) await rm(askpassDir, { recursive: true, force: true }).catch(() => {})
  }
}

function mapGitError(error: unknown): SourceResolutionError {
  const detail = error as { stderr?: string, message?: string }
  const text = `${detail.stderr ?? ''}\n${detail.message ?? ''}`
  if (/Authentication failed|could not read Username|terminal prompts disabled|Permission denied|HTTP 401|HTTP 403/i.test(text)) {
    return new SourceResolutionError('git-auth', 'git 需要凭据或当前凭据无权访问')
  }
  if (/not found|does not appear to be a git repository|repository .* does not exist/i.test(text)) {
    return new SourceResolutionError('git-not-found', 'git 仓库不存在或不可访问')
  }
  if (/Could not resolve host|unable to access|Connection refused|timed out|timeout/i.test(text)) {
    return new SourceResolutionError('git-unreachable', '无法连接 git 仓库，请检查网络或地址')
  }
  return new SourceResolutionError('git-error', 'git 命令执行失败')
}

async function withFolderShas(dir: string, entries: SourceCatalogEntry[]): Promise<SourceCatalogEntry[]> {
  const result: SourceCatalogEntry[] = []
  for (const entry of entries) {
    const spec = entry.skillPath === SKILL_FILE
      ? 'HEAD^{tree}'
      : `HEAD:${entry.skillPath.split('/').slice(0, -1).join('/')}`
    const folderSha = await revParse(dir, spec).catch(() => undefined)
    result.push({ ...entry, folderSha })
  }
  return result
}

async function revParse(dir: string, spec: string): Promise<string> {
  const output = await runGit(['-C', dir, 'rev-parse', spec], 10_000)
  return output.trim()
}

/** 浅克隆到指定空目录；安装事务复用它，避免把临时目录逻辑复制两份。 */
export async function cloneGitSource(parsed: ParsedSource, destination: string, auth: GitAuth = {}): Promise<void> {
  const cloneArgs = ['clone', '--depth', '1', '--no-tags', '--single-branch']
  if (parsed.ref && !/^[\da-f]{40}$/i.test(parsed.ref)) cloneArgs.push('--branch', parsed.ref)
  cloneArgs.push(parsed.source, destination)
  await runGit(cloneArgs, auth.timeoutMs ?? GIT_TIMEOUT, auth.token)

  if (parsed.ref && /^[\da-f]{40}$/i.test(parsed.ref)) {
    await runGit(['-C', destination, 'fetch', '--depth', '1', 'origin', parsed.ref], auth.timeoutMs ?? GIT_TIMEOUT, auth.token)
    await runGit(['-C', destination, 'checkout', '--detach', 'FETCH_HEAD'], auth.timeoutMs ?? GIT_TIMEOUT, auth.token)
  }
}
