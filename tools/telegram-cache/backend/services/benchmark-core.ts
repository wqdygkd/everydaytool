// 基准测试的纯计算部分（不依赖 Electron），便于自检：
// 把「开始 / 结束」两次累计计数相减，得到本次场景的可观测增量。
// 计数在观测被清空时会回绕（end < start），此时把该字段记 0 并标记 resetDetected，
// 由调用方写进 note，避免把无效样本当成省流量结论。
import type { TelegramBenchmarkCounters } from '../../../../shared/telegram-cache.ts'

const COUNTER_KEYS: (keyof TelegramBenchmarkCounters)[] = [
  'requests',
  'completed',
  'failed',
  'fromCache',
  'networkBytes',
  'unknownSizeCount',
  'cacheServedBytes',
  'localHits',
  'localMisses',
  'revalidations',
  'revalidationHits',
  'pageCapturedBytes',
]

export interface BenchmarkDelta {
  counters: TelegramBenchmarkCounters
  resetDetected: boolean
}

export function diffBenchmarkCounters(
  start: TelegramBenchmarkCounters,
  end: TelegramBenchmarkCounters,
): BenchmarkDelta {
  const counters = {} as TelegramBenchmarkCounters
  let resetDetected = false
  for (const key of COUNTER_KEYS) {
    const delta = (end[key] ?? 0) - (start[key] ?? 0)
    if (delta < 0) resetDetected = true
    counters[key] = Math.max(0, delta)
  }
  return { counters, resetDetected }
}
