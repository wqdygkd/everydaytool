// 平台级后端基建：所有工具的后端共用。只放与具体工具域无关的能力（日志 / 文件操作 / 数据目录），
// 工具专属逻辑留在各自 tools/<id>/backend/ 内。Node ESM：源码相对导入写 .ts 后缀，
// scripts/build-electron.mjs 在产物中改写为 .js 运行时后缀。
import { Buffer } from 'node:buffer'
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogMeta = Record<string, unknown>

const MAX_LOG_BYTES = 5 * 1024 * 1024
let logDirectory: string | null = null
let logFilePath: string | null = null
let logBytes = 0

function formatMessage(level: LogLevel, message: string, meta?: LogMeta): string {
  const timestamp = new Date().toISOString()
  const suffix = meta ? ` ${JSON.stringify(meta)}` : ''
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${suffix}`
}

function rotateLog(): void {
  if (!logFilePath) return
  const rotated = `${logFilePath}.1`
  try {
    rmSync(rotated, { force: true })
    renameSync(logFilePath, rotated)
  }
  catch {
    // 轮转失败不应影响应用：继续写当前文件，下一次再试
  }
  logBytes = 0
}

function writeLogLine(line: string): void {
  if (!logFilePath) return
  try {
    const payload = `${line}\n`
    appendFileSync(logFilePath, payload, 'utf8')
    logBytes += Buffer.byteLength(payload)
    if (logBytes >= MAX_LOG_BYTES) rotateLog()
  }
  catch {
    // 磁盘满 / 权限不足时静默降级为仅控制台
  }
}

/** 由 main 在数据根就绪后调用；logger 不反向依赖 data-layers，避免启动期循环导入。 */
export function configureFileLogging(directory: string): void {
  try {
    mkdirSync(directory, { recursive: true })
    const filePath = path.join(directory, 'main.log')
    logDirectory = directory
    logFilePath = filePath
    logBytes = statSync(filePath).size
    if (logBytes >= MAX_LOG_BYTES) rotateLog()
  }
  catch {
    logDirectory = null
    logFilePath = null
    logBytes = 0
  }
}

export function getLogDirectory(): string | null {
  return logDirectory
}

export const logger = {
  debug(message: string, meta?: LogMeta): void {
    const line = formatMessage('debug', message, meta)
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.debug(line)
      writeLogLine(line)
    }
  },
  info(message: string, meta?: LogMeta): void {
    const line = formatMessage('info', message, meta)
    // eslint-disable-next-line no-console
    console.info(line)
    writeLogLine(line)
  },
  warn(message: string, meta?: LogMeta): void {
    const line = formatMessage('warn', message, meta)
    console.warn(line)
    writeLogLine(line)
  },
  error(message: string, meta?: LogMeta): void {
    const line = formatMessage('error', message, meta)
    console.error(line)
    writeLogLine(line)
  },
}
