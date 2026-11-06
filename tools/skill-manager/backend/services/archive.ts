import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import process from 'node:process'
import { gunzipSync } from 'node:zlib'

const TAR_BLOCK = 512
const MAX_TARBALL_BYTES = 64 * 1024 * 1024
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024
const MAX_ENTRIES = 10_000

export class ArchiveError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ArchiveError'
    this.code = code
  }
}

/** 下载 GitHub tarball；带大小上限与超时，不把整个响应无限读进内存。 */
export async function downloadGithubTarball(
  source: string,
  ref: string,
  destination: string,
  token?: string,
): Promise<void> {
  const [owner, repo] = source.split('/')
  if (!owner || !repo) throw new ArchiveError('invalid-source', 'GitHub 来源缺少 owner/repo')
  const url = `https://codeload.github.com/${encodeSegment(owner)}/${encodeSegment(repo)}/tar.gz/${encodeRef(ref)}`
  const headers: Record<string, string> = { 'User-Agent': 'everydaytool-skill-manager' }
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(120_000), redirect: 'follow' })
  }
  catch {
    throw new ArchiveError('download-failed', '无法下载 GitHub 压缩包，请检查网络或代理')
  }
  if (!response.ok) {
    if (response.status === 404) throw new ArchiveError('download-not-found', 'GitHub 压缩包不存在，ref 可能已失效')
    if (response.status === 401 || response.status === 403) throw new ArchiveError('download-auth', 'GitHub 拒绝下载，请检查 token 权限')
    throw new ArchiveError('download-failed', `GitHub 压缩包下载失败（HTTP ${response.status}）`)
  }

  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > MAX_TARBALL_BYTES) {
    throw new ArchiveError('archive-too-large', `压缩包超过 ${Math.round(MAX_TARBALL_BYTES / 1024 / 1024)}MB，已拒绝`)
  }
  const body = response.body
  if (!body) throw new ArchiveError('download-failed', 'GitHub 返回了空响应')
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_TARBALL_BYTES) throw new ArchiveError('archive-too-large', '压缩包超过大小上限，已中止')
      chunks.push(value)
    }
  }
  finally {
    reader.releaseLock()
  }
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, Buffer.concat(chunks))
}

interface TarEntry {
  path: string
  type: string
  size: number
  dataStart: number
}

/** 解压 tar.gz 到目录；只接受普通文件/目录，拒绝链接、设备与路径穿越。 */
export async function extractTarGz(buffer: Buffer, destination: string): Promise<{ entries: number, bytes: number }> {
  let unpacked: Buffer
  try {
    unpacked = gunzipSync(buffer, { maxOutputLength: MAX_UNPACKED_BYTES })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ArchiveError('archive-invalid', `压缩包解压失败：${message}`)
  }

  const root = resolve(destination)
  await mkdir(root, { recursive: true })
  const entries = parseTar(unpacked)
  let bytes = 0
  for (const entry of entries) {
    const target = resolve(root, entry.path)
    const rel = relative(root, target)
    if (!rel || rel.startsWith('..') || rel.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      throw new ArchiveError('archive-unsafe-path', `压缩包包含不安全路径：${entry.path}`)
    }
    if (entry.type === '5') {
      await mkdir(target, { recursive: true })
      continue
    }
    // GitHub tarball may contain repository-level symlinks; never materialize them.
    if (entry.type === '2') continue
    if (entry.type !== '0' && entry.type !== '\0' && entry.type !== '7') {
      throw new ArchiveError('archive-unsafe-entry', `压缩包包含不支持的条目类型：${entry.type} ${entry.path}`)
    }
    bytes += entry.size
    if (bytes > MAX_UNPACKED_BYTES) throw new ArchiveError('archive-too-large', '解压后体积超过上限')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, unpacked.subarray(entry.dataStart, entry.dataStart + entry.size), { mode: 0o644 })
  }
  return { entries: entries.length, bytes }
}

function parseTar(buffer: Buffer): TarEntry[] {
  const entries: TarEntry[] = []
  let offset = 0
  let paxPath: string | undefined
  while (offset + TAR_BLOCK <= buffer.length) {
    const header = buffer.subarray(offset, offset + TAR_BLOCK)
    if (header.every(byte => byte === 0)) break
    const name = readCString(header, 0, 100)
    const prefix = readCString(header, 345, 155)
    const size = parseOctal(readCString(header, 124, 12))
    const type = String.fromCharCode(header[156] ?? 0)
    const dataStart = offset + TAR_BLOCK
    if (!Number.isSafeInteger(size) || size < 0 || dataStart + size > buffer.length) {
      throw new ArchiveError('archive-invalid', 'tar 条目长度非法')
    }
    if (type === 'x' || type === 'g') {
      if (type === 'x') {
        const body = buffer.subarray(dataStart, dataStart + size).toString('utf8')
        paxPath = parsePaxPath(body) ?? paxPath
      }
      offset = dataStart + align(size)
      continue
    }
    if (type === 'L') {
      paxPath = readCString(buffer.subarray(dataStart, dataStart + size), 0, size).trim()
      offset = dataStart + align(size)
      continue
    }
    if (entries.length >= MAX_ENTRIES) throw new ArchiveError('archive-too-many-entries', '压缩包条目过多')
    const rawPath = paxPath ?? (prefix ? `${prefix}/${name}` : name)
    paxPath = undefined
    const path = normalizeTarPath(rawPath)
    if (path) {
      entries.push({
        path,
        type,
        size,
        dataStart,
      })
    }
    offset = dataStart + align(size)
  }
  return entries
}

function parsePaxPath(body: string): string | undefined {
  for (const line of body.split('\n')) {
    const index = line.indexOf(' ')
    if (index <= 0) continue
    const record = line.slice(index + 1)
    const equals = record.indexOf('=')
    if (equals < 0) continue
    if (record.slice(0, equals) === 'path') return record.slice(equals + 1)
  }
  return undefined
}

function normalizeTarPath(raw: string): string {
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
  if (!normalized) return ''
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw new ArchiveError('archive-unsafe-path', `压缩包包含绝对路径：${raw}`)
  }
  const segments = normalized.split('/')
  if (segments.some(segment => segment === '..' || segment === '')) {
    throw new ArchiveError('archive-unsafe-path', `压缩包包含越界路径：${raw}`)
  }
  return normalized
}

function parseOctal(value: string): number {
  const trimmed = value.replace(/\0/g, '').trim()
  if (!trimmed) return 0
  if (!/^[0-7]+$/.test(trimmed)) throw new ArchiveError('archive-invalid', 'tar 条目大小不是八进制')
  return Number.parseInt(trimmed, 8)
}

function readCString(buffer: Buffer, start: number, length: number): string {
  const slice = buffer.subarray(start, start + length)
  const nul = slice.indexOf(0)
  return slice.subarray(0, nul < 0 ? slice.length : nul).toString('utf8')
}

function align(size: number): number {
  return Math.ceil(size / TAR_BLOCK) * TAR_BLOCK
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

function encodeRef(ref: string): string {
  return ref.split('/').map(encodeSegment).join('/')
}
