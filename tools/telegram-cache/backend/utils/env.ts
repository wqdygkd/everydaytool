// MTProto 本地凭据读取（只在主进程）：api_id / api_hash / session 来自进程环境或 .env。
// 硬约束：
// - 返回值只用于连接 GramJS，**绝不写日志、绝不发往渲染层**；
// - missing 只返回字段名，不返回任何值；
// - .env 的顺序：项目根（开发）→ 数据目录 → userData；process.env 优先级最高。
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { app } from 'electron'
import { APP_ROOT_DEV, getDataDirectory } from '../../../../backend/utils/data-root.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { isSessionEncryptionAvailable, readSecureSession } from './session-store.ts'

export type MtprotoSessionSource = 'secure' | 'env' | 'none'

export interface MtprotoCredentials {
  apiId: number
  apiHash: string
  session: string
  sessionSource: MtprotoSessionSource
  logLevel: number
}

export interface MtprotoConfigState {
  configured: boolean
  hasSession: boolean
  sessionSource: MtprotoSessionSource
  encryptionAvailable: boolean
  missing: string[]
  value?: MtprotoCredentials
}

function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(filePath)) return out
  try {
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const body = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed
      const eq = body.indexOf('=')
      if (eq <= 0) continue
      const key = body.slice(0, eq).trim()
      if (!/^[\w.-]+$/.test(key)) continue
      let value = body.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
  } catch (error) {
    logger.warn('Failed to read .env file', { file: path.basename(filePath), error: (error as Error).message })
  }
  return out
}

function candidateEnvFiles(): string[] {
  const files = [
    path.join(APP_ROOT_DEV, '.env'),
    path.join(getDataDirectory(), '.env'),
  ]
  try {
    files.push(path.join(app.getPath('userData'), '.env'))
  } catch {
    // userData 不可用时忽略
  }
  return files
}

function readEnv(): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const file of candidateEnvFiles()) {
    Object.assign(merged, parseEnvFile(file))
  }
  // 进程环境优先（便于 CI / 临时覆盖）
  for (const key of ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_SESSION', 'TELEGRAM_LOG_LEVEL']) {
    const value = process.env[key]
    if (typeof value === 'string' && value.trim()) merged[key] = value.trim()
  }
  return merged
}

export function readMtprotoConfig(): MtprotoConfigState {
  const env = readEnv()
  const missing: string[] = []
  const rawId = env.TELEGRAM_API_ID ?? ''
  const apiId = Number(rawId)
  if (!rawId) missing.push('TELEGRAM_API_ID')
  else if (!Number.isSafeInteger(apiId) || apiId <= 0) missing.push('TELEGRAM_API_ID（非法）')
  const apiHash = env.TELEGRAM_API_HASH ?? ''
  if (!apiHash) missing.push('TELEGRAM_API_HASH')

  // 会话优先级：OS 加密存储 > .env 明文。加密文件解密失败时回退 .env，避免换机器后直接不可用。
  const secureSession = readSecureSession() ?? ''
  const envSession = env.TELEGRAM_SESSION ?? ''
  const session = secureSession || envSession
  const sessionSource: MtprotoSessionSource = secureSession ? 'secure' : envSession ? 'env' : 'none'
  if (!session) missing.push('TELEGRAM_SESSION（先运行 pnpm telegram:session）')

  const encryptionAvailable = isSessionEncryptionAvailable()
  if (missing.length > 0) {
    return {
      configured: Boolean(rawId && apiHash),
      hasSession: Boolean(session),
      sessionSource,
      encryptionAvailable,
      missing,
    }
  }

  const rawLevel = Number(env.TELEGRAM_LOG_LEVEL)
  return {
    configured: true,
    hasSession: true,
    sessionSource,
    encryptionAvailable,
    missing: [],
    value: {
      apiId,
      apiHash,
      session,
      sessionSource,
      logLevel: Number.isFinite(rawLevel) ? Math.min(4, Math.max(0, Math.floor(rawLevel))) : 1,
    },
  }
}
