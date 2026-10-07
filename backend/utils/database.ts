// 平台级共享 SQLite 连接：数据根下只有一个 config.db，所有工具域共用同一连接与
// 生命周期（建目录 / WAL / 外键 / 关闭），工具域只注册自己的 CREATE TABLE。
// 工具域不得再各自 new Database，否则会出现两套连接、两处不同的初始化与关闭规则。
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getDatabasePath } from './data-root.ts'
import { logger } from './logger.ts'

type Db = Database.Database

let db: Db | null = null
let initialized = false

/** 工具域注册的建表语句；连接已存在时立即执行，否则在首次建连时执行 */
const schemas: string[] = []

export function registerSchema(schema: string): void {
  const trimmed = schema.trim()
  if (!trimmed) return
  schemas.push(trimmed)
  if (db) {
    db.exec(trimmed)
  }
}

export function getSharedDatabase(): Db {
  if (db) return db

  const dbPath = getDatabasePath()
  mkdirSync(path.dirname(dbPath), { recursive: true })

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  for (const schema of schemas) {
    db.exec(schema)
  }
  initialized = true
  logger.info('Shared database initialized')
  return db
}

export function closeSharedDatabase(): void {
  if (!db) return
  try {
    // 关闭前做一次 checkpoint，避免 WAL 残留
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch (error) {
    logger.warn('Failed to checkpoint database', { error: (error as Error).message })
  }
  db.close()
  db = null
  initialized = false
}

export function isDatabaseInitialized(): boolean {
  return initialized
}
