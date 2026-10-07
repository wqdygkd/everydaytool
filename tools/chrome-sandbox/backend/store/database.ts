import type BetterSqlite3 from 'better-sqlite3'
import { closeSharedDatabase, getSharedDatabase, registerSchema } from '../../../../backend/utils/database.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sandboxes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    color TEXT,
    user_data_path TEXT NOT NULL,
    chrome_pid INTEGER,
    status TEXT DEFAULT 'stopped',
    fingerprint_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME,
    last_active_at DATETIME,
    metadata TEXT
);

CREATE TABLE IF NOT EXISTS fingerprints (
    id TEXT PRIMARY KEY,
    user_agent TEXT,
    platform TEXT,
    language TEXT,
    hardware_concurrency INTEGER,
    device_memory INTEGER,
    canvas_noise_level TEXT,
    canvas_noise_seed INTEGER,
    webgl_vendor TEXT,
    webgl_renderer TEXT,
    screen_width INTEGER,
    screen_height INTEGER,
    screen_color_depth INTEGER,
    device_pixel_ratio REAL,
    audio_noise_enabled INTEGER DEFAULT 1,
    audio_noise_level REAL,
    timezone_offset INTEGER,
    timezone_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS global_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sandboxes_status ON sandboxes(status);
`

registerSchema(SCHEMA)

/**
 * 沙箱域使用的共享数据库连接（与 env-browser 等工具域同一连接）：
 * 保留本模块是为了不破坏既有导入路径，实际生命周期由 backend/utils/database.ts 统一管理。
 */
export function getDatabase(): BetterSqlite3.Database {
  return getSharedDatabase()
}

export function reloadDatabase(): BetterSqlite3.Database {
  closeSharedDatabase()
  return getSharedDatabase()
}

export function closeDatabase(): void {
  closeSharedDatabase()
}
