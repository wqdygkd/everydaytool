import type { PikpakFetch, PikpakStop } from './api.ts'
import { Buffer } from 'node:buffer'
// 字节传输与内容校验（TS 移植自 PikpakGet 的 stream.py）。
// 单流与分段共用 fetch 流式写盘，支持 Range 续传、空闲超时、结构化进度。
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { PikpakError } from './errors.ts'

export const CHUNK = 1 << 20
const STALL_SECONDS = 90
const DEFAULT_IDLE_TIMEOUT_MS = STALL_SECONDS * 1000

// PikPak 的 `hash` 是「每块 SHA-1 的 SHA-1」，块大小是上传客户端的选择；下面是从样本
// 推断的候选分片大小。verifyContent 返回 null 表示「未证明」，不等于「证明损坏」。
export const PIECE_SIZES = [
  1 << 20,
  2 << 20,
  512 << 10,
  4 << 20,
  8 << 20,
  16 << 20,
  32 << 20,
  256 << 10,
  128 << 10,
  64 << 10,
]

export async function contentHash(filePath: string, piece: number): Promise<string> {
  const outer = createHash('sha1')
  const stream = createReadStream(filePath, { highWaterMark: CHUNK })
  let buffer = Buffer.alloc(0)
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk as Buffer])
    while (buffer.length >= piece) {
      const block = buffer.subarray(0, piece)
      outer.update(createHash('sha1').update(block).digest())
      buffer = buffer.subarray(piece)
    }
  }
  if (buffer.length) {
    outer.update(createHash('sha1').update(buffer).digest())
  }
  return outer.digest('hex').toUpperCase()
}

export async function verifyContent(
  filePath: string,
  expected: string,
  pieceSizes: readonly number[] = PIECE_SIZES,
): Promise<number | null> {
  if (!expected) return null
  const wanted = expected.toUpperCase()
  for (const piece of pieceSizes) {
    if (piece && await contentHash(filePath, piece) === wanted) return piece
  }
  return null
}

export interface DownloadStreamOptions {
  fetchImpl: PikpakFetch
  onProgress?: (written: number, elapsed: number) => void
  stop?: PikpakStop
  idleTimeoutMs?: number
}

async function readAllBody(
  res: Response,
  targetHandle: Awaited<ReturnType<typeof open>>,
  stop: PikpakStop | undefined,
  idleTimeoutMs: number,
  onProgress: ((written: number, elapsed: number) => void) | undefined,
): Promise<number> {
  if (!res.body) throw new PikpakError('上游未返回文件流')
  const reader = res.body.getReader()
  const started = Date.now()
  let written = 0

  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const arm = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => reader.cancel('idle-timeout').catch(() => undefined), idleTimeoutMs)
  }
  arm()

  try {
    while (true) {
      if (stop?.()) throw new PikpakError('已中断（.part 已保留）')
      let result: Awaited<ReturnType<typeof reader.read>>
      try {
        result = await reader.read()
      } catch (error) {
        if (String(error).includes('idle-timeout')) {
          throw new PikpakError(`下载超时：${Math.round(idleTimeoutMs / 1000)} 秒未收到新数据`)
        }
        throw new PikpakError(`下载连接中断: ${(error as Error).message}`)
      }
      arm()
      if (result.done) break
      if (result.value && result.value.length) {
        await targetHandle.write(result.value)
        written += result.value.length
        onProgress?.(written, (Date.now() - started) / 1000)
      }
    }
    return written
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
  }
}

/** 单流下载到 `target`，从 `resumeFrom` 续传；返回最终字节数。 */
export async function downloadStream(
  url: string,
  target: string,
  expectedSize: number,
  resumeFrom: number,
  options: DownloadStreamOptions,
): Promise<number> {
  const { fetchImpl, onProgress, stop, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = options
  const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity' }
  if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`

  const res = await fetchImpl(url, { headers })
  if (!res.ok) {
    throw new PikpakError(`下载被拒: HTTP ${res.status}`, { status: res.status, throttled: [403, 429, 503].includes(res.status) })
  }

  let written = resumeFrom
  if (resumeFrom > 0 && res.status !== 206) written = 0

  const handle = await open(target, written > 0 ? 'a' : 'w')
  try {
    written = await readAllBody(res, handle, stop, idleTimeoutMs, onProgress)
  } finally {
    await handle.close()
  }

  if (expectedSize && written !== expectedSize) {
    throw new PikpakError(`下载不完整 ${written}/${expectedSize}`, { action: 'download' })
  }
  return written
}

/** 下载指定 Range 到 `target`（append 模式），返回本次写入字节数。 */
async function downloadRange(
  url: string,
  target: string,
  start: number,
  end: number,
  options: DownloadStreamOptions,
): Promise<number> {
  const { fetchImpl, onProgress, stop, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = options
  const headers: Record<string, string> = { 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity', 'Range': `bytes=${start}-${end}` }
  const res = await fetchImpl(url, { headers })
  if (!res.ok) {
    throw new PikpakError(`下载被拒: HTTP ${res.status}`, { status: res.status, throttled: [403, 429, 503].includes(res.status) })
  }
  if (res.status !== 206) throw new PikpakError('服务器不支持 Range 分段，请改用单连接')
  const want = end - start + 1
  const handle = await open(target, 'a')
  try {
    const written = await readAllBody(res, handle, stop, idleTimeoutMs, onProgress)
    if (written !== want) throw new PikpakError(`分段不完整 ${written}/${want}`, { action: 'download' })
    return written
  } finally {
    await handle.close()
  }
}

/** 并发分段下载到 `target`；每段独立 Range 续传，完成后按序拼接。 */
export async function downloadSegments(
  urlOf: () => Promise<string>,
  target: string,
  total: number,
  connections: number,
  options: DownloadStreamOptions,
): Promise<number> {
  const { fetchImpl, onProgress, stop, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = options
  if (connections <= 1) {
    const url = await urlOf()
    const have = await stat(target).then(s => s.size).catch(() => 0)
    return downloadStream(url, target, total, have, options)
  }

  const segDir = `${target}.segs${connections}`
  const parentDir = path.dirname(target)
  const base = path.basename(target)
  const entries = await readdir(parentDir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(`${base}.segs`) && entry.name !== `${base}.segs${connections}`) {
      await rm(path.join(parentDir, entry.name), { recursive: true, force: true })
    }
  }
  await mkdir(segDir, { recursive: true })

  const edges = Array.from({ length: connections + 1 }, (_, i) => Math.floor(total * i / connections))
  const segments: Array<{ index: number, start: number, end: number, want: number, have: number }> = []
  for (let i = 0; i < connections; i += 1) {
    const start = edges[i]!
    const end = edges[i + 1]! - 1
    if (end < start) continue
    segments.push({ index: i, start, end, want: end - start + 1, have: 0 })
  }

  for (const seg of segments) {
    const segPath = path.join(segDir, String(seg.index).padStart(3, '0'))
    let have = await stat(segPath).then(s => s.size).catch(() => 0)
    if (have > seg.want) {
      await rm(segPath, { force: true })
      have = 0
    }
    seg.have = have
  }

  const report = (): void => {
    onProgress?.(segments.reduce((sum, seg) => sum + seg.have, 0), 0)
  }
  report()

  await Promise.all(segments.map(async (seg) => {
    if (seg.have >= seg.want) return
    const segPath = path.join(segDir, String(seg.index).padStart(3, '0'))
    const url = await urlOf()
    const initialHave = seg.have
    const written = await downloadRange(url, segPath, seg.start + initialHave, seg.end, {
      fetchImpl,
      stop,
      idleTimeoutMs,
      onProgress: (w) => {
        seg.have = initialHave + w
        report()
      },
    })
    seg.have = initialHave + written
  }))
  report()

  for (const seg of segments) {
    if (seg.have < seg.want) throw new PikpakError(`分段 ${seg.index} 未完成 ${seg.have}/${seg.want}`, { action: 'download' })
  }

  const out = await open(target, 'w')
  try {
    for (const seg of segments) {
      const segPath = path.join(segDir, String(seg.index).padStart(3, '0'))
      let remaining = seg.want
      for await (const chunk of createReadStream(segPath)) {
        if (stop?.()) throw new PikpakError('已中断（片段已保留）')
        if (remaining <= 0) break
        const take = Math.min((chunk as Buffer).length, remaining)
        await out.write((chunk as Buffer).subarray(0, take))
        remaining -= take
      }
      if (remaining) throw new PikpakError(`分段 ${seg.index} 实际字节不足 ${remaining}`, { action: 'download' })
    }
  } finally {
    await out.close()
  }

  await rm(segDir, { recursive: true, force: true })
  return total
}
