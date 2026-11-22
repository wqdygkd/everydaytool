import { Buffer } from 'node:buffer'
// edt-kdf:v1 —— 可移植密钥信封（scrypt + AES-256-GCM）。
// 与 Python 引擎的 crypto.py 字节兼容：同一格式、同一参数，换机可还原。
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto'

const PREFIX = 'edt-kdf'
const VERSION = 'v1'
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32
const SALT_LEN = 16
const NONCE_LEN = 12
const TAG_LEN = 16

export const KEYCHECK_PLAINTEXT = 'pikpakget-keycheck'
const KEYCHECK_ACCOUNT = 'keycheck'
const KEYCHECK_FIELD = 'check'

function b64e(raw: Buffer): string {
  return raw.toString('base64url')
}

function b64d(text: string): Buffer {
  return Buffer.from(text, 'base64url')
}

function deriveKey(masterKey: string, salt: Buffer): Buffer {
  return scryptSync(masterKey, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
}

function aad(accountId: string, field: string): Buffer {
  return Buffer.from(`pikpakget:${accountId}:${field}`, 'utf8')
}

export function seal(plain: string, masterKey: string, accountId: string, field: string): string {
  const salt = randomBytes(SALT_LEN)
  const nonce = randomBytes(NONCE_LEN)
  const key = deriveKey(masterKey, salt)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(aad(accountId, field))
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const payload = Buffer.concat([ct, tag])
  return `${PREFIX}:${VERSION}:${b64e(salt)}:${b64e(nonce)}:${b64e(payload)}`
}

export function openSealed(envelope: string, masterKey: string, accountId: string, field: string): string {
  const parts = envelope.split(':')
  if (parts.length !== 5 || parts[0] !== PREFIX || parts[1] !== VERSION) {
    throw new Error('unsupported secret envelope')
  }
  const salt = b64d(parts[2]!)
  const nonce = b64d(parts[3]!)
  const payload = b64d(parts[4]!)
  const key = deriveKey(masterKey, salt)
  const ct = payload.subarray(0, payload.length - TAG_LEN)
  const tag = payload.subarray(payload.length - TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAAD(aad(accountId, field))
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch (error) {
    throw new Error('cannot decrypt secret (wrong master key or corrupted data)', { cause: error })
  }
}

export function makeKeycheck(masterKey: string): string {
  return seal(KEYCHECK_PLAINTEXT, masterKey, KEYCHECK_ACCOUNT, KEYCHECK_FIELD)
}

export function verifyKeycheck(envelope: string, masterKey: string): boolean {
  try {
    return openSealed(envelope, masterKey, KEYCHECK_ACCOUNT, KEYCHECK_FIELD) === KEYCHECK_PLAINTEXT
  } catch {
    return false
  }
}
