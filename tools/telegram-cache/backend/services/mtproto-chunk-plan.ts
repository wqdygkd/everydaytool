// MTProto 分块 / 续传的**库无关字节数学**（M3-B 前置脚手架）。
//
// 这里只做区间规划与校验，不假设 teleproto 的 offset / limit 语义：
// 接入真实库之前必须用固定媒体实测“返回字节数 = limit”“越界 offset 行为”“取消后能否从
// committedOffset 继续”，再把实际语义映射到本文件。纯函数便于自检，也便于换成其它实现。
//
// 约定：所有区间都是**闭区间** [start, end]，单位字节；文件大小 0 表示空文件。

export interface ByteRange {
  start: number
  end: number
}

export interface ChunkPlan {
  index: number
  offset: number
  limit: number
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} 必须是非负安全整数`)
}

/** 把文件按 chunkSize 切成顺序分块（最后一块可能更小） */
export function planChunks(totalSize: number, chunkSize: number): ChunkPlan[] {
  assertNonNegativeInteger(totalSize, 'totalSize')
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) throw new Error('chunkSize 必须是正整数')
  const chunks: ChunkPlan[] = []
  for (let offset = 0, index = 0; offset < totalSize; offset += chunkSize, index += 1) {
    chunks.push({ index, offset, limit: Math.min(chunkSize, totalSize - offset) })
  }
  return chunks
}

/** 校验单个区间；非法返回 null（调用方应丢弃而不是猜测修正） */
export function normalizeRange(range: ByteRange): ByteRange | null {
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)) return null
  if (range.start < 0 || range.end < range.start) return null
  return { start: range.start, end: range.end }
}

/** 合并重叠 / 相邻区间，返回按起点升序的规范区间 */
export function mergeRanges(ranges: readonly ByteRange[]): ByteRange[] {
  const normalized = ranges
    .map(range => normalizeRange(range))
    .filter((range): range is ByteRange => range !== null)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: ByteRange[] = []
  for (const range of normalized) {
    const last = merged[merged.length - 1]
    if (!last || range.start > last.end + 1) {
      merged.push({ ...range })
    } else if (range.end > last.end) {
      last.end = range.end
    }
  }
  return merged
}

/**
 * 已提交（可安全续传）的字节数：只有从 0 开始**连续**的区间才算数。
 * 中间有洞时，洞后面的数据即使收到过也不能跳过——续传必须从第一个洞重新开始。
 */
export function committedBytes(ranges: readonly ByteRange[]): number {
  const merged = mergeRanges(ranges)
  if (merged.length === 0 || merged[0].start !== 0) return 0
  let committed = 0
  for (const range of merged) {
    if (range.start > committed) break
    committed = Math.max(committed, range.end + 1)
  }
  return committed
}

/** 还缺哪些区间（用于续传请求） */
export function missingRanges(ranges: readonly ByteRange[], totalSize: number): ByteRange[] {
  assertNonNegativeInteger(totalSize, 'totalSize')
  if (totalSize === 0) return []
  const merged = mergeRanges(ranges)
  const missing: ByteRange[] = []
  let cursor = 0
  for (const range of merged) {
    if (range.end < cursor) continue
    if (range.start > cursor) missing.push({ start: cursor, end: Math.min(range.start - 1, totalSize - 1) })
    cursor = Math.max(cursor, range.end + 1)
    if (cursor >= totalSize) break
  }
  if (cursor < totalSize) missing.push({ start: cursor, end: totalSize - 1 })
  return missing
}

/** 是否所有字节都已连续覆盖（完整性前置条件；SHA-256 仍需在完整文件上另算） */
export function isComplete(ranges: readonly ByteRange[], totalSize: number): boolean {
  return totalSize === 0 ? true : committedBytes(ranges) === totalSize
}
