import type { EnvConfig, EnvCreatePayload, EnvUpdatePayload } from '../../../../shared/types.ts'
import { randomUUID } from 'node:crypto'
import { closeSharedDatabase, getSharedDatabase, registerSchema } from '../../../../backend/utils/database.ts'
import { logger } from '../../../../backend/utils/logger.ts'

const ENV_SCHEMA = `
CREATE TABLE IF NOT EXISTS env_browser_configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    remark TEXT,
    auto_login INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

// 建表语句交给平台层统一执行（与 chrome-sandbox 共用同一连接）
registerSchema(ENV_SCHEMA)

// 共享连接由平台层统一管理（建目录 / WAL / 外键 / 关闭），这里不再自建连接
function getDb(): import('better-sqlite3').Database {
  return getSharedDatabase()
}

/** 关闭共享连接（数据根目录变更后 / 退出时调用，下次访问按新目录重开） */
export function closeEnvDatabase(): void {
  closeSharedDatabase()
}

function rowToEnv(row: Record<string, unknown>): EnvConfig {
  return {
    id: row.id as string,
    name: row.name as string,
    url: row.url as string,
    username: row.username as string,
    password: row.password as string,
    remark: (row.remark as string | null) ?? null,
    autoLogin: (row.auto_login as number) ?? 1,
    createdAt: (row.created_at as string) ?? null,
    updatedAt: (row.updated_at as string) ?? null,
  }
}

function getById(id: string): EnvConfig | null {
  const row = getDb().prepare('SELECT * FROM env_browser_configs WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToEnv(row) : null
}

export const envStore = {
  getAll(): EnvConfig[] {
    const database = getDb()
    const rows = database.prepare('SELECT * FROM env_browser_configs ORDER BY created_at DESC').all() as Record<string, unknown>[]
    return rows.map(rowToEnv)
  },

  create(payload: EnvCreatePayload): EnvConfig {
    const database = getDb()
    const id = `env_${randomUUID().replace(/-/g, '').slice(0, 10)}`
    const now = new Date().toISOString()
    database.prepare(`
      INSERT INTO env_browser_configs (id, name, url, username, password, remark, auto_login, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      payload.name,
      payload.url,
      payload.username,
      payload.password,
      payload.remark || null,
      payload.autoLogin === false ? 0 : 1,
      now,
      now,
    )
    logger.info('Env created', { id, name: payload.name })
    return getById(id)!
  },

  update(id: string, payload: EnvUpdatePayload): EnvConfig | null {
    const existing = getById(id)
    if (!existing) return null
    const database = getDb()
    const now = new Date().toISOString()
    const name = payload.name ?? existing.name
    const url = payload.url ?? existing.url
    const username = payload.username ?? existing.username
    const password = payload.password ?? existing.password
    const remark = payload.remark !== undefined ? payload.remark : existing.remark
    const autoLogin = payload.autoLogin !== undefined ? (payload.autoLogin ? 1 : 0) : existing.autoLogin

    database.prepare(`
      UPDATE env_browser_configs SET name=?, url=?, username=?, password=?, remark=?, auto_login=?, updated_at=? WHERE id=?
    `).run(name, url, username, password, remark, autoLogin, now, id)
    return getById(id)
  },

  delete(id: string): boolean {
    const database = getDb()
    const result = database.prepare('DELETE FROM env_browser_configs WHERE id=?').run(id)
    return result.changes > 0
  },
}
