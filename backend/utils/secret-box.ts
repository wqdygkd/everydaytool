// 凭据的静态加密（at-rest）：把明文密文包一层 Electron safeStorage（Windows DPAPI / macOS Keychain）。
//
// 为什么放在平台基建：env-browser 的账号密码、wxp 采集到的 token 都要落盘，但都不该以明文躺在
// `<data>/config/...` 里（配置层会被导出成备份包）。这里提供统一的 **信封格式**：
//
//   edt-secret:<base64(safeStorage.encryptString(plain))>
//
// 读取时 `openSecret()` 自动识别信封；不是信封的值原样返回 —— 也就是**旧明文文件可以照旧读**，
// 由各 store 在第一次写入时顺带升级成密文（避免一次性迁移脚本）。
//
// safeStorage 不可用（Linux 无 keyring、调用过早等）时 `sealSecret()` 退化为明文并 warn：
// 宁可功能可用且日志可见，也不要因为加密不可用而写不进配置。
import { Buffer } from 'node:buffer'
import { safeStorage } from 'electron'
import { logger } from './logger.ts'

const ENVELOPE_PREFIX = 'edt-secret:'

/** safeStorage 是否可用（可用才有加密可言；不可用时调用方应保持明文并提示） */
export function isSecretStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function isSealedSecret(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX)
}

/**
 * 加密成信封字符串。safeStorage 不可用或加密失败时返回原文（并 warn），
 * 保证「加密是增强，不是功能前提」。
 */
export function sealSecret(plain: string, label = 'secret'): string {
  if (!plain) return plain
  if (!isSecretStorageAvailable()) {
    logger.warn('safeStorage unavailable; secret kept in plaintext', { label })
    return plain
  }
  try {
    const encrypted = safeStorage.encryptString(plain)
    return `${ENVELOPE_PREFIX}${encrypted.toString('base64')}`
  } catch (error) {
    logger.warn('Failed to seal secret; kept in plaintext', { label, error: (error as Error).message })
    return plain
  }
}

export interface OpenedSecret {
  /** 明文；信封解不开时为空串 */
  value: string
  /**
   * 是信封但解不开（换机器 / 系统密钥变化）。调用方**必须保留原密文不要写回**——
   * 把空串当新密码落盘等于静默删掉用户的凭据。
   */
  failed: boolean
}

/**
 * 解封：信封 → 明文；普通字符串 → 原样返回（旧明文数据）。
 * 解密失败时 `failed: true` 且 `value` 为空串，由调用方决定如何提示与保留。
 */
export function openSecretDetailed(value: string, label = 'secret'): OpenedSecret {
  if (!isSealedSecret(value)) return { value, failed: false }
  try {
    const payload = Buffer.from(value.slice(ENVELOPE_PREFIX.length), 'base64')
    return { value: safeStorage.decryptString(payload), failed: false }
  } catch (error) {
    logger.warn('Failed to open sealed secret (machine changed or keychain reset?)', {
      label,
      error: (error as Error).message,
    })
    return { value: '', failed: true }
  }
}

/** 只要明文的简写；**会丢掉「解不开」这个信息**，落盘路径请用 `openSecretDetailed` */
export function openSecret(value: string, label = 'secret'): string {
  return openSecretDetailed(value, label).value
}
