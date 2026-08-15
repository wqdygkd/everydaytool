import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { logger } from '../utils/logger.js'
import { getDatabasePath } from '../utils/path-helper.js'

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

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (db) return db

  const dbPath = getDatabasePath()
  mkdirSync(path.dirname(dbPath), { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  logger.info('Database initialized', { dbPath })
  return db
}

export function reloadDatabase(): Database.Database {
  closeDatabase()
  return getDatabase()
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
