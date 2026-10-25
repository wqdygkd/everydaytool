// telegram-cache 配置（data-root/telegram-cache/config.json）：
// 生产入口必须做 schema 校验与 clamp —— 渲染层传上来的数值不可信，
// 也不允许远程页面通过 URL 参数开启高风险能力（本版本没有可开启的高风险能力）。
import type { TelegramCacheConfig } from '../../../../shared/telegram-cache.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import {
  TELEGRAM_DEFAULT_CONFIG,
  TELEGRAM_MAX_CACHE_BYTES,
  TELEGRAM_MAX_HTTP_CONCURRENCY,
  TELEGRAM_MAX_RESOURCE_BYTES,
  TELEGRAM_MIN_CACHE_BYTES,
  TELEGRAM_MIN_HTTP_CONCURRENCY,
  TELEGRAM_MIN_RESOURCE_BYTES,
} from '../../../../shared/telegram-cache.ts'
import { getTelegramConfigPath } from '../utils/paths.ts'

interface TelegramConfigDocument {
  schemaVersion: 1
  config: TelegramCacheConfig
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function sanitize(input: unknown): TelegramCacheConfig {
  const record = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  return {
    observationEnabled: typeof record.observationEnabled === 'boolean'
      ? record.observationEnabled
      : TELEGRAM_DEFAULT_CONFIG.observationEnabled,
    maxHttpConcurrency: clampInt(
      record.maxHttpConcurrency,
      TELEGRAM_MIN_HTTP_CONCURRENCY,
      TELEGRAM_MAX_HTTP_CONCURRENCY,
      TELEGRAM_DEFAULT_CONFIG.maxHttpConcurrency,
    ),
    maxResourceBytes: clampInt(
      record.maxResourceBytes,
      TELEGRAM_MIN_RESOURCE_BYTES,
      TELEGRAM_MAX_RESOURCE_BYTES,
      TELEGRAM_DEFAULT_CONFIG.maxResourceBytes,
    ),
    cacheMaxBytes: clampInt(
      record.cacheMaxBytes,
      TELEGRAM_MIN_CACHE_BYTES,
      TELEGRAM_MAX_CACHE_BYTES,
      TELEGRAM_DEFAULT_CONFIG.cacheMaxBytes,
    ),
    localResponseEnabled: typeof record.localResponseEnabled === 'boolean'
      ? record.localResponseEnabled
      : TELEGRAM_DEFAULT_CONFIG.localResponseEnabled,
    localMediaRangeEnabled: typeof record.localMediaRangeEnabled === 'boolean'
      ? record.localMediaRangeEnabled
      : TELEGRAM_DEFAULT_CONFIG.localMediaRangeEnabled,
    enablePageCapture: typeof record.enablePageCapture === 'boolean'
      ? record.enablePageCapture
      : TELEGRAM_DEFAULT_CONFIG.enablePageCapture,
  }
}

function readDocument(): TelegramConfigDocument {
  const doc = readJsonDocument<Partial<TelegramConfigDocument>>(getTelegramConfigPath(), () => ({}))
  return { schemaVersion: 1, config: sanitize(doc.config) }
}

export function getTelegramCacheConfig(): TelegramCacheConfig {
  return readDocument().config
}

/** 合并式更新：只接受已知字段，非法值回落到上限 / 下限而不是报错中断 */
export function updateTelegramCacheConfig(patch: unknown): TelegramCacheConfig {
  const current = getTelegramCacheConfig()
  const record = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<string, unknown>
  const next = sanitize({ ...current, ...record })
  const doc: TelegramConfigDocument = { schemaVersion: 1, config: next }
  writeJsonDocument(getTelegramConfigPath(), doc)
  return next
}
