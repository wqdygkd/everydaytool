// MTProto 分块下载核心（不依赖 Electron / GramJS）：
// 由调用方注入「从 offset 开始的异步字节流」，本模块负责追加写入、增量哈希、
// committed 推进、节流落盘与取消。这样可以在 Node 里用假数据验证续传语义。
//
// 关键不变量：
// - 只有成功写入文件的字节才更新 hash 与 committed；
// - 取消 / 异常退出时保留文件与 state.committed，调用方可截断到 committed 后继续；
// - 重试前必须 truncate(tmpPath, state.committed)，避免半块数据被重复追加。
import type { Hash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { once } from 'node:events'
import { createReadStream, createWriteStream } from 'node:fs'
import { finished } from 'node:stream/promises'

export interface ChunkedDownloadOptions {
  tmpPath: string
  totalSize: number
  hash: Hash
  /** 可变进度；异常时调用方从这里读取已安全写入的字节数 */
  state: { committed: number }
  /** 从 offset 开始、最多 limit 字节的异步流 */
  createIterator: (offset: number, limit: number) => AsyncIterable<Buffer | Uint8Array>
  signal: AbortSignal
  onProgress?: (committed: number) => void
  /** 节流落盘断点（例如每 800ms 一次） */
  flush?: (committed: number) => Promise<void>
  flushIntervalMs?: number
}

export async function runChunkedDownload(options: ChunkedDownloadOptions): Promise<number> {
  const {
    tmpPath,
    totalSize,
    hash,
    state,
    createIterator,
    signal,
    onProgress,
    flush,
    flushIntervalMs = 800,
  } = options

  let committed = state.committed
  const stream = createWriteStream(tmpPath, { flags: 'a' })
  let lastFlush = 0
  try {
    for await (const raw of createIterator(committed, totalSize - committed)) {
      if (signal.aborted) break
      if (!raw || raw.length === 0) continue
      const remaining = totalSize - committed
      if (remaining <= 0) break
      let chunk = Buffer.from(raw)
      if (chunk.length > remaining) chunk = chunk.subarray(0, remaining)
      if (!stream.write(chunk)) await once(stream, 'drain')
      // 写入成功后才计入哈希与进度：抛错时 committed 不会越过文件真实内容
      hash.update(chunk)
      committed += chunk.length
      state.committed = committed
      onProgress?.(committed)
      if (flush && Date.now() - lastFlush > flushIntervalMs) {
        lastFlush = Date.now()
        await flush(committed)
      }
    }
  } finally {
    stream.end()
    await finished(stream).catch(() => {})
  }
  return committed
}

/** 续传前重建哈希：把文件中 [0, bytes) 的前缀喂给 hash */
export async function hashFilePrefix(filePath: string, bytes: number, hash: Hash): Promise<void> {
  if (bytes <= 0) return
  const stream = createReadStream(filePath, { start: 0, end: bytes - 1 })
  for await (const chunk of stream) hash.update(chunk)
}
