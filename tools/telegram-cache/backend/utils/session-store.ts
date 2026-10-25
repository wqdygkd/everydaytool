// MTProto 会话字符串的安全存储：优先 Electron safeStorage（Windows DPAPI / macOS Keychain），
// 文件放在**应用数据目录**下，内容为 base64 的密文。
//
// 路径迁移：早期版本把密文放在 userData，首次读取/写入时自动搬到
// <data-root>/telegram-cache/telegram-session.bin；运行期切换数据目录时，下一次解析
// 会把旧数据目录里的文件搬到新目录（文件不常驻打开，可安全移动）。
//
// 约束：
// - 任何函数都不打印、不返回会话内容给渲染层（只返回状态）；
// - 安全存储不可用时返回 null / false，由调用方回退到 .env；
// - 清除只删除本工具生成的密文文件，不碰用户的 .env。
import { Buffer } from 'node:buffer'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { getDataDirectory } from '../../../../backend/utils/data-root.ts'
import { logger } from '../../../../backend/utils/logger.ts'

const require = createRequire(import.meta.url)
const { app, safeStorage } = require('electron') as typeof import('electron')

const SESSION_FILE = 'telegram-session.bin'

let lastResolvedPath: string | null = null

function dataDirectorySessionPath(): string {
  return path.join(getDataDirectory(), 'telegram-cache', SESSION_FILE)
}

function legacyUserDataSessionPath(): string {
  return path.join(app.getPath('userData'), SESSION_FILE)
}

function moveFile(source: string, dest: string): void {
  mkdirSync(path.dirname(dest), { recursive: true })
  try {
    renameSync(source, dest)
  } catch {
    // 跨卷时 rename 会 EXDEV：复制后删除源文件
    copyFileSync(source, dest)
    rmSync(source, { force: true })
  }
}

/**
 * 解析当前会话文件路径，并把旧位置的文件迁移过来。
 * 顺序：数据目录目标 > 上一次解析到的旧位置 > 早期 userData 位置。
 */
function resolveSessionFilePath(): string {
  const next = dataDirectorySessionPath()
  if (!existsSync(next)) {
    const candidates = [lastResolvedPath, legacyUserDataSessionPath()]
    for (const source of candidates) {
      if (!source || source === next || !existsSync(source)) continue
      try {
        moveFile(source, next)
        logger.info('MTProto session file relocated to data directory')
        break
      } catch (error) {
        logger.warn('Failed to relocate MTProto session file', { error: (error as Error).message })
      }
    }
  }
  lastResolvedPath = next
  return next
}

export function isSessionEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** 读取并解密会话；文件不存在 / 解密失败（换机器、系统密钥变化）返回 null */
export function readSecureSession(): string | null {
  const filePath = resolveSessionFilePath()
  if (!existsSync(filePath)) return null
  try {
    const encoded = readFileSync(filePath, 'utf8').trim()
    if (!encoded) return null
    if (!isSessionEncryptionAvailable()) return null
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch {
    return null
  }
}

/** 加密写入会话；安全存储不可用或写入失败返回 false */
export function writeSecureSession(session: string): boolean {
  if (typeof session !== 'string' || !session || !isSessionEncryptionAvailable()) return false
  try {
    const filePath = resolveSessionFilePath()
    mkdirSync(path.dirname(filePath), { recursive: true })
    const encrypted = safeStorage.encryptString(session)
    writeFileSync(filePath, encrypted.toString('base64'), { encoding: 'utf8', mode: 0o600 })
    return true
  } catch {
    return false
  }
}

export function clearSecureSession(): void {
  try {
    rmSync(resolveSessionFilePath(), { force: true })
  } catch {
    // 文件不存在 / 被占用：忽略
  }
}

/** 数据目录切换后调用：把密文文件搬到新数据目录（失败保留旧文件） */
export function relocateSecureSessionFile(): string {
  return resolveSessionFilePath()
}
