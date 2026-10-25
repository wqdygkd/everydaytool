// 平台级 JSON 文档存储（同步）：小体量的本地数据（沙箱列表 / 指纹 / 工具配置 / 环境账号）
// 直接落 JSON 文件，进程内按绝对路径缓存解析结果，避免每次读取都碰磁盘。
// 读多写少且单进程独占：写入走「临时文件 + rename」，不会留下半截 JSON；
// 数据根目录变更后由平台 IPC 调用 invalidateJsonDocuments() 丢弃按绝对路径缓存的旧条目。
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { logger } from './logger.ts'

const documents = new Map<string, unknown>()

function backupCorruptedFile(filePath: string, raw: string): void {
  try {
    writeFileSync(`${filePath}.corrupt`, raw, 'utf8')
  } catch {
    // 备份失败不影响主流程
  }
}

/**
 * 读取 JSON 文档；文件不存在或已损坏时用 createDefault() 兜底。
 * 兜底结果同样进缓存，因此后续写入只需覆盖一次文件。
 */
export function readJsonDocument<T>(filePath: string, createDefault: () => T): T {
  const resolved = path.resolve(filePath)
  if (documents.has(resolved)) return documents.get(resolved) as T

  let data: T
  let raw: string | null = null
  try {
    if (existsSync(resolved)) raw = readFileSync(resolved, 'utf8')
  } catch (error) {
    logger.warn('Failed to read JSON store file, fallback applied', {
      file: path.basename(resolved),
      error: (error as Error).message,
    })
  }
  if (raw === null) {
    data = createDefault()
  } else {
    try {
      data = JSON.parse(raw) as T
    } catch (error) {
      // 解析失败说明文件已损坏：保留现场副本再兜底，避免用户数据无声消失
      backupCorruptedFile(resolved, raw)
      logger.warn('JSON store file is corrupted, fallback applied', {
        file: path.basename(resolved),
        error: (error as Error).message,
      })
      data = createDefault()
    }
  }

  documents.set(resolved, data)
  return data
}

/** 写入 JSON 文档并同步内存缓存（先写临时文件再 rename，避免进程中断留下坏文件） */
export function writeJsonDocument<T>(filePath: string, data: T): void {
  const resolved = path.resolve(filePath)
  const tempPath = `${resolved}.${process.pid}.tmp`

  mkdirSync(path.dirname(resolved), { recursive: true })
  try {
    writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    renameSync(tempPath, resolved)
  } catch (error) {
    rmSync(tempPath, { force: true })
    logger.error('Failed to write JSON store file', { file: path.basename(resolved), error: (error as Error).message })
    throw error
  }

  documents.set(resolved, data)
}

/**
 * 数据根目录变更后清空全部缓存：文档按绝对路径缓存，旧目录的条目必须一起丢弃，
 * 否则切回旧目录时会读到切换前的内存快照而不是磁盘现状。
 */
export function invalidateJsonDocuments(): void {
  documents.clear()
}
