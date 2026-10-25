// M2 基准测试服务：记录「开始 / 结束」两次累计计数的差值，落盘为可复现样本。
// 只使用观测口径（content-length）与本地缓存计量，不读取网卡真实流量。
import type {
  TelegramBenchmarkCounters,
  TelegramBenchmarkRecord,
  TelegramBenchmarkStatus,
} from '../../../../shared/telegram-cache.ts'
import { randomUUID } from 'node:crypto'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { TELEGRAM_CACHE_IPC_CHANNELS } from '../ipc/channels.ts'
import { getTelegramBenchmarkPath } from '../utils/paths.ts'
import { diffBenchmarkCounters } from './benchmark-core.ts'
import { getTelegramCacheMeters } from './cache-manager.ts'
import { getTelegramObservationStats } from './observation-service.ts'
import { getPageCaptureStats } from './page-capture-service.ts'

const MAX_RECORDS = 50

interface BenchmarkDocument {
  schemaVersion: 1
  records: TelegramBenchmarkRecord[]
}

interface ActiveBenchmark {
  id: string
  label: string
  startedAt: number
  snapshot: TelegramBenchmarkCounters
}

let active: ActiveBenchmark | null = null

function emptyDocument(): BenchmarkDocument {
  return { schemaVersion: 1, records: [] }
}

function readDocument(): BenchmarkDocument {
  const doc = readJsonDocument<BenchmarkDocument>(getTelegramBenchmarkPath(), emptyDocument)
  if (!doc || !Array.isArray(doc.records)) return emptyDocument()
  return {
    schemaVersion: 1,
    records: doc.records.filter(record => record && typeof record.id === 'string').slice(0, MAX_RECORDS),
  }
}

function writeDocument(doc: BenchmarkDocument): void {
  writeJsonDocument(getTelegramBenchmarkPath(), doc)
}

function snapshotCounters(): TelegramBenchmarkCounters {
  const stats = getTelegramObservationStats()
  const cache = getTelegramCacheMeters()
  const capture = getPageCaptureStats()
  return {
    requests: stats.requests,
    completed: stats.completed,
    failed: stats.failed,
    fromCache: stats.fromCache,
    networkBytes: stats.networkBytes,
    unknownSizeCount: stats.unknownSizeCount,
    cacheServedBytes: cache.servedBytes,
    localHits: cache.localHits,
    localMisses: cache.localMisses,
    revalidations: cache.revalidations,
    revalidationHits: cache.revalidationHits,
    pageCapturedBytes: capture.bytes,
  }
}

export function getBenchmarkStatus(): TelegramBenchmarkStatus {
  return {
    active: active
      ? { id: active.id, label: active.label, startedAt: active.startedAt, snapshot: active.snapshot }
      : null,
    records: readDocument().records,
  }
}

export function listBenchmarkRecords(): TelegramBenchmarkRecord[] {
  return readDocument().records
}

function emitStatus(): void {
  broadcastToWindows(TELEGRAM_CACHE_IPC_CHANNELS.EVENT_BENCHMARK, getBenchmarkStatus(), {
    onError: error => logger.warn('Benchmark status broadcast failed', { error: error.message }),
  })
}

function sanitizeLabel(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  const cleaned = raw.replace(/[\r\n\t]/g, ' ').slice(0, 60)
  return cleaned || `run-${new Date().toISOString().slice(0, 16)}`
}

/** 开始一段基准测试；同一时间只允许一段，避免把两个场景混在一起 */
export function startBenchmark(label: unknown): TelegramBenchmarkStatus {
  if (active) throw new Error('已有基准测试在进行，请先结束当前测试')
  active = {
    id: `bm-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
    label: sanitizeLabel(label),
    startedAt: Date.now(),
    snapshot: snapshotCounters(),
  }
  logger.info('Benchmark started', { label: active.label })
  emitStatus()
  return getBenchmarkStatus()
}

/** 结束并落盘：差值由纯函数计算，计数回绕时在 note 里标明样本可能无效 */
export function stopBenchmark(): TelegramBenchmarkRecord {
  if (!active) throw new Error('当前没有进行中的基准测试')
  const current = active
  const endedAt = Date.now()
  const { counters, resetDetected } = diffBenchmarkCounters(current.snapshot, snapshotCounters())
  const record: TelegramBenchmarkRecord = {
    ...counters,
    id: current.id,
    label: current.label,
    startedAt: current.startedAt,
    endedAt,
    durationMs: endedAt - current.startedAt,
    networkBytesPerRequest: counters.requests > 0
      ? Math.round(counters.networkBytes / counters.requests)
      : null,
    ...(resetDetected ? { note: '观测计数在测试期间被清空或回绕，本样本可能无效' } : {}),
  }
  const doc = readDocument()
  doc.records = [record, ...doc.records].slice(0, MAX_RECORDS)
  writeDocument(doc)
  active = null
  emitStatus()
  logger.info('Benchmark stopped', {
    label: record.label,
    networkBytes: record.networkBytes,
    cacheServedBytes: record.cacheServedBytes,
  })
  return record
}

export function clearBenchmarks(): TelegramBenchmarkStatus {
  writeDocument(emptyDocument())
  emitStatus()
  return getBenchmarkStatus()
}

export function disposeBenchmark(): void {
  active = null
}
