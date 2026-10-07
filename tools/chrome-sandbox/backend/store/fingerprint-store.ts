import type {
  Fingerprint,
  FingerprintCreatePayload,
  FingerprintUpdatePayload,
} from '../../../../shared/types.ts'
import { getDatabase } from './database.ts'

interface FingerprintRow {
  id: string
  user_agent: string
  platform: string
  language: string
  hardware_concurrency: number
  device_memory: number
  canvas_noise_level: string
  canvas_noise_seed: number
  webgl_vendor: string
  webgl_renderer: string
  screen_width: number
  screen_height: number
  screen_color_depth: number
  device_pixel_ratio: number
  audio_noise_enabled: number
  audio_noise_level: number
  timezone_offset: number
  timezone_name: string
  created_at: string
  updated_at: string | null
}

type FingerprintData = FingerprintCreatePayload

interface FieldDef {
  key: string
  col: keyof FingerprintRow
  transform?: (v: unknown) => unknown
}

const FIELDS: FieldDef[] = [
  { key: 'id', col: 'id' },
  { key: 'navigator.userAgent', col: 'user_agent' },
  { key: 'navigator.platform', col: 'platform' },
  { key: 'navigator.language', col: 'language' },
  { key: 'navigator.hardwareConcurrency', col: 'hardware_concurrency' },
  { key: 'navigator.deviceMemory', col: 'device_memory' },
  { key: 'canvas.noiseLevel', col: 'canvas_noise_level' },
  { key: 'canvas.noiseSeed', col: 'canvas_noise_seed' },
  { key: 'webgl.vendor', col: 'webgl_vendor' },
  { key: 'webgl.renderer', col: 'webgl_renderer' },
  { key: 'screen.width', col: 'screen_width' },
  { key: 'screen.height', col: 'screen_height' },
  { key: 'screen.colorDepth', col: 'screen_color_depth' },
  { key: 'screen.devicePixelRatio', col: 'device_pixel_ratio' },
  { key: 'audio.noiseEnabled', col: 'audio_noise_enabled', transform: v => v ? 1 : 0 },
  { key: 'audio.noiseLevel', col: 'audio_noise_level' },
  { key: 'timezone.offset', col: 'timezone_offset' },
  { key: 'timezone.name', col: 'timezone_name' },
]

function getNestedValue(obj: unknown, path: string): unknown {
  const keys = path.split('.')
  let value: unknown = obj
  for (const k of keys) value = (value as Record<string, unknown>)?.[k]
  return value
}

function mapRow(row: FingerprintRow | undefined): Fingerprint | null {
  if (!row) return null
  return {
    id: row.id,
    navigator: {
      userAgent: row.user_agent,
      platform: row.platform,
      language: row.language,
      hardwareConcurrency: row.hardware_concurrency,
      deviceMemory: row.device_memory,
    },
    canvas: {
      noiseLevel: row.canvas_noise_level as Fingerprint['canvas']['noiseLevel'],
      noiseSeed: row.canvas_noise_seed,
    },
    webgl: {
      vendor: row.webgl_vendor,
      renderer: row.webgl_renderer,
    },
    screen: {
      width: row.screen_width,
      height: row.screen_height,
      colorDepth: row.screen_color_depth,
      devicePixelRatio: row.device_pixel_ratio,
    },
    audio: {
      noiseEnabled: Boolean(row.audio_noise_enabled),
      noiseLevel: row.audio_noise_level,
    },
    timezone: {
      offset: row.timezone_offset,
      name: row.timezone_name,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function buildParams(data: FingerprintData): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const f of FIELDS) {
    if (f.key === 'id') continue
    const value = getNestedValue(data, f.key)
    params[f.col] = f.transform ? f.transform(value) : value
  }
  return params
}

const INSERT_FIELDS = FIELDS.filter(f => f.key !== 'id')
const INSERT_COLS = INSERT_FIELDS.map(f => f.col).join(', ')
const INSERT_PARAMS = INSERT_FIELDS.map(f => `@${f.col}`).join(', ')

/** 判断嵌套路径在对象里是否真的存在（区分「显式 null」与「未提供」） */
function hasNestedKey(obj: unknown, path: string): boolean {
  const keys = path.split('.')
  let current: unknown = obj
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) return false
    if (!(key in (current as Record<string, unknown>))) return false
    current = (current as Record<string, unknown>)[key]
  }
  return true
}

/** 只收集本次实际传入的字段，避免把未提供的值写成 NULL */
function buildUpdateParams(data: FingerprintData): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const f of INSERT_FIELDS) {
    if (!hasNestedKey(data, f.key)) continue
    const value = getNestedValue(data, f.key)
    params[f.col] = f.transform ? f.transform(value) : value
  }
  return params
}

export const fingerprintStore = {
  getById(id: string): Fingerprint | null {
    const row = getDatabase().prepare('SELECT * FROM fingerprints WHERE id = ?').get(id) as
      | FingerprintRow
      | undefined
    return mapRow(row)
  },

  create(data: FingerprintData): Fingerprint | null {
    getDatabase().prepare(`
      INSERT INTO fingerprints (id, ${INSERT_COLS}) VALUES (@id, ${INSERT_PARAMS})
    `).run({ id: data.id, ...buildParams(data) })
    return this.getById(data.id)
  },

  /**
   * 部分更新：只更新传入的字段（dynamic SET 子句）。
   * 早期实现会把 Partial 强转成完整对象写满所有列，缺失字段会写 undefined 或把已有值覆盖为 NULL。
   */
  update(id: string, data: FingerprintUpdatePayload): Fingerprint | null {
    const params = buildUpdateParams(data as FingerprintData)
    const columns = Object.keys(params)
    if (!columns.length) return this.getById(id)

    const assignments = columns.map(col => `${col} = @${col}`).join(', ')
    getDatabase().prepare(`
      UPDATE fingerprints SET ${assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = @id
    `).run({ id, ...params })
    return this.getById(id)
  },

  delete(id: string | null | undefined): void {
    if (!id) return
    getDatabase().prepare('DELETE FROM fingerprints WHERE id = ?').run(id)
  },
}
