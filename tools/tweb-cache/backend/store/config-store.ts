// tweb-cache 配置（`<config>/tweb-cache/config.json`）：只存站点端口这类本工具私有设置。
// 归档索引由 scope 落在 `<config>/tweb-cache/`，本文件只管理站点自身配置。
import type { TwebCacheConfig } from '../../../../shared/tweb-cache.ts'
import { resolveLayerPath } from '../../../../backend/utils/data-layers.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import {
  TWEB_CACHE_SITE_PORT_MAX,
  TWEB_CACHE_SITE_PORT_MIN,
} from '../../../../shared/tweb-cache.ts'

interface TwebConfigDocument {
  schemaVersion: 1
  config: TwebCacheConfig
}

function configPath(): string {
  return resolveLayerPath('config', 'tweb-cache', 'config.json')
}

/** 端口只接受合法值，其余回落 null（下次重新分配），刻意不做 clamp 掩盖问题 */
function sanitizeSitePort(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < TWEB_CACHE_SITE_PORT_MIN || value > TWEB_CACHE_SITE_PORT_MAX) return null
  return value
}

function sanitize(input: unknown): TwebCacheConfig {
  const record = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  return { sitePort: sanitizeSitePort(record.sitePort) }
}

function readDocument(): TwebConfigDocument {
  const doc = readJsonDocument<Partial<TwebConfigDocument>>(configPath(), () => ({}))
  return { schemaVersion: 1, config: sanitize(doc.config) }
}

export function getTwebCacheConfig(): TwebCacheConfig {
  return readDocument().config
}

export function updateTwebCacheConfig(patch: unknown): TwebCacheConfig {
  const current = getTwebCacheConfig()
  const record = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<string, unknown>
  const next = sanitize({ ...current, ...record })
  writeJsonDocument(configPath(), { schemaVersion: 1, config: next } satisfies TwebConfigDocument)
  return next
}
