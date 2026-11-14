import type { WriteStream } from 'node:fs'
import { Buffer } from 'node:buffer'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import process from 'node:process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, gunzipSync } from 'node:zlib'
import { logger } from '../../../../backend/utils/logger.ts'

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
  let total = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length
      if (total > MAX_TARBALL_BYTES) {
        callback(new ArchiveError('archive-too-large', '压缩包超过大小上限，已中止'))
        return
      }
      callback(null, chunk)
    },
  })
  await mkdir(dirname(destination), { recursive: true })
  try {
    await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), limiter, createWriteStream(destination))
  }
  catch (error) {
    if (error instanceof ArchiveError) throw error
    throw new ArchiveError('download-failed', `GitHub 压缩包写入失败：${(error as Error).message}`)
  }
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

interface FileExtractOptions {
  /** 只落盘这些相对路径（仓库顶层目录之下的路径；空数组表示全部） */
  includes?: string[]
}

type ExtractPhase
  = | { kind: 'header' }
    | { kind: 'meta', type: string, size: number, remaining: number, chunks: Buffer[] }
    | { kind: 'data', size: number, remaining: number, out: WriteStream | null }
    | { kind: 'padding', remaining: number }

function writeChunk(out: WriteStream, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    out.write(chunk, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function closeStream(out: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    out.once('error', reject)
    out.end(() => resolve())
  })
}

/**
 * 文件版流式解包：gunzip 与 tar 解析都在流上完成，只把命中 includes 的条目写盘。
 * 安装单个技能时不再把整个仓库解压后的内容读进内存。
 */
export async function extractTarGzFile(
  tarballPath: string,
  destination: string,
  options: FileExtractOptions = {},
): Promise<{ entries: number, bytes: number }> {
  const startedAt = Date.now()
  const root = resolve(destination)
  await mkdir(root, { recursive: true })
  const includes = (options.includes ?? []).filter(Boolean)
  const includeAll = includes.length === 0 || includes.includes('')

  const matches = (entryPath: string): boolean => {
    if (includeAll) return true
    const candidates = [entryPath]
    const slash = entryPath.indexOf('/')
    if (slash > 0) candidates.push(entryPath.slice(slash + 1))
    return candidates.some(candidate => includes.some(
      include => candidate === include || candidate.startsWith(`${include}/`),
    ))
  }

  let pending: Buffer = Buffer.alloc(0)
  let paxPath: string | undefined
  let phase: ExtractPhase = { kind: 'header' }
  let entries = 0
  let unpackedBytes = 0
  let finished = false

  const source = createReadStream(tarballPath)
  const stream = source.pipe(createGunzip())

  const consume = async (): Promise<void> => {
    while (!finished) {
      if (phase.kind === 'header') {
        if (pending.length < TAR_BLOCK) return
        const header = pending.subarray(0, TAR_BLOCK)
        if (header.every(byte => byte === 0)) {
          finished = true
          pending = Buffer.alloc(0)
          return
        }
        pending = pending.subarray(TAR_BLOCK)
        const name = readCString(header, 0, 100)
        const prefix = readCString(header, 345, 155)
        const size = parseOctal(readCString(header, 124, 12))
        const type = String.fromCharCode(header[156] ?? 0)
        if (!Number.isSafeInteger(size) || size < 0) {
          throw new ArchiveError('archive-invalid', 'tar 条目长度非法')
        }
        if (type === 'x' || type === 'g' || type === 'L') {
          phase = { kind: 'meta', type, size, remaining: size, chunks: [] }
          continue
        }
        if (entries >= MAX_ENTRIES) throw new ArchiveError('archive-too-many-entries', '压缩包条目过多')
        entries += 1
        const rawPath = paxPath ?? (prefix ? `${prefix}/${name}` : name)
        paxPath = undefined
        const entryPath = normalizeTarPath(rawPath)
        if (type === '5') {
          if (entryPath && matches(entryPath)) await mkdir(resolve(root, entryPath), { recursive: true })
          phase = { kind: 'padding', remaining: align(size) - size }
          continue
        }
        // GitHub tarball 可能带仓库级符号链接：一律跳过，不落盘
        if (type === '2') {
          phase = { kind: 'padding', remaining: align(size) - size }
          continue
        }
        if (type !== '0' && type !== '\0' && type !== '7') {
          throw new ArchiveError('archive-unsafe-entry', `压缩包包含不支持的条目类型：${type} ${entryPath}`)
        }
        unpackedBytes += size
        if (unpackedBytes > MAX_UNPACKED_BYTES) throw new ArchiveError('archive-too-large', '解压后体积超过上限')

        let out: WriteStream | null = null
        if (entryPath && matches(entryPath)) {
          const target = resolve(root, entryPath)
          const rel = relative(root, target)
          if (!rel || rel.startsWith('..') || rel.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
            throw new ArchiveError('archive-unsafe-path', `压缩包包含不安全路径：${entryPath}`)
          }
          await mkdir(dirname(target), { recursive: true })
          out = createWriteStream(target, { mode: 0o644 })
        }
        phase = { kind: 'data', size, remaining: size, out }
        continue
      }

      if (phase.kind === 'meta') {
        if (phase.remaining > 0) {
          const take = Math.min(phase.remaining, pending.length)
          if (take === 0) return
          phase.chunks.push(pending.subarray(0, take))
          pending = pending.subarray(take)
          phase.remaining -= take
          if (phase.remaining > 0) return
        }
        const body = Buffer.concat(phase.chunks).toString('utf8')
        if (phase.type === 'x') paxPath = parsePaxPath(body) ?? paxPath
        else if (phase.type === 'L') paxPath = body.trim()
        phase = { kind: 'padding', remaining: align(phase.size) - phase.size }
        continue
      }

      if (phase.kind === 'data') {
        if (phase.remaining > 0) {
          const take = Math.min(phase.remaining, pending.length)
          if (take === 0) return
          if (phase.out) await writeChunk(phase.out, pending.subarray(0, take))
          pending = pending.subarray(take)
          phase.remaining -= take
          if (phase.remaining > 0) return
        }
        if (phase.out) await closeStream(phase.out)
        phase = { kind: 'padding', remaining: align(phase.size) - phase.size }
        continue
      }

      if (phase.remaining > 0) {
        if (pending.length === 0) return
        const take = Math.min(phase.remaining, pending.length)
        pending = pending.subarray(take)
        phase.remaining -= take
        if (phase.remaining > 0) return
      }
      phase = { kind: 'header' }
    }
  }

  try {
    for await (const chunk of stream) {
      pending = pending.length ? Buffer.concat([pending, chunk as Buffer]) : chunk as Buffer
      await consume()
      if (finished) break
    }
    if (!finished && (phase.kind !== 'header' || pending.length > 0)) {
      throw new ArchiveError('archive-invalid', 'tar 归档提前结束')
    }
  } catch (error) {
    if (error instanceof ArchiveError) throw error
    throw new ArchiveError('archive-invalid', `压缩包解压失败：${(error as Error).message}`)
  }

  logger.debug('skill-manager tarball extracted', {
    elapsedMs: Date.now() - startedAt,
    entries,
    unpackedBytes,
    includes: includes.length,
  })
  return { entries, bytes: unpackedBytes }
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
