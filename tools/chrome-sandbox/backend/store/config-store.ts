import type { AppConfig, AppConfigUpdate } from '../../../../shared/types.ts'
import { getDataDirectory, getDefaultDataDirectory, normalizeDataDirectory } from '../../../../backend/utils/data-root.ts'
import { getDatabase } from './database.ts'

const DEFAULTS: AppConfig = {
  chromePath: '',
  defaultProfile: '',
  dataDirectory: getDefaultDataDirectory(),
  autoRestoreOnStartup: false,
  preserveDataOnClose: true,
}

interface ConfigRow {
  key: string
  value: string
}

export const configStore = {
  getAll(): AppConfig {
    const rows = getDatabase().prepare('SELECT key, value FROM global_config').all() as ConfigRow[]
    const config: Record<string, unknown> = { ...DEFAULTS }
    for (const row of rows) {
      try {
        config[row.key] = JSON.parse(row.value)
      } catch {
        config[row.key] = row.value
      }
    }
    config.dataDirectory = getDataDirectory()
    return config as unknown as AppConfig
  },

  get<T = unknown>(key: string): T {
    const row = getDatabase().prepare('SELECT value FROM global_config WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (!row) return DEFAULTS[key as keyof AppConfig] as unknown as T
    try {
      return JSON.parse(row.value) as T
    } catch {
      return row.value as unknown as T
    }
  },

  update(data: AppConfigUpdate): AppConfig {
    const payload: Record<string, unknown> = { ...data }
    if ('dataDirectory' in payload) {
      payload.dataDirectory = normalizeDataDirectory(payload.dataDirectory as string) || getDefaultDataDirectory()
    }

    const stmt = getDatabase().prepare(`
      INSERT INTO global_config (key, value, updated_at)
      VALUES (@key, @value, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `)

    for (const [key, value] of Object.entries(payload)) {
      stmt.run({ key, value: JSON.stringify(value) })
    }
    return this.getAll()
  },
}
