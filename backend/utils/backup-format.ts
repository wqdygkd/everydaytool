// 备份包容器的编解码（`.edtbackup`）：**不引入任何原生依赖**，只用 node:crypto + node:zlib。
//
// 物理格式（大端）：
//   [0..4)   magic 'EDTB'
//   [4]      格式版本（1）
//   [5]      flags：bit0 = 已加密
//   [6..10)  header 长度（u32）
//   [10..)   header（JSON，仅放加密参数：kdf / salt / iv；未加密时为空对象）
//   其后     payload
//
// payload = gzip(fileTable)，fileTable：
//   u32 条目数
//   重复：u16 名字长度、名字(utf8)、u32 数据长度、数据
//   第一个条目固定是 manifest.json（包的目录），其余是 `${layer}/${relativePath}` 形式的文件。
//
// 加密：scrypt(口令, salt, 32) → AES-256-GCM(payload, iv)，tag 附在密文末尾。
// 口令只保护「文件被别人拿走」这一层；UI 上仍要提示用户妥善保管备份包。
import type { BackupFileRecord, BackupManifest } from '../../shared/backup.ts'
import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { BACKUP_FORMAT_VERSION, BACKUP_MAGIC } from '../../shared/backup.ts'
import { logger } from './logger.ts'

const KDF = { N: 16_384, r: 8, p: 1, keyLength: 32, saltLength: 16 } as const
const IV_LENGTH = 12
const MAX_HEADER_BYTES = 64 * 1024
const MAX_FILE_COUNT = 500_000
const MAX_NAME_BYTES = 4096

const MANIFEST_ENTRY_NAME = 'manifest.json'

export interface BackupArchiveContent {
  manifest: BackupManifest
  files: BackupFileRecord[]
}

export interface BackupArchiveHeader {
  version: number
  encrypted: boolean
  /** 只解析头部（不解密），用于导入前判断是否需要口令 */
  needsPassword: boolean
}

interface CryptoHeader {
  kdf?: 'scrypt'
  n?: number
  r?: number
  p?: number
  salt?: string
  iv?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 是否像一份备份包（只读前 5 字节，供「打开文件」时的快速判断） */
export function looksLikeBackupArchive(buffer: Buffer): boolean {
  if (buffer.length < 10) return false
  return buffer.subarray(0, 4).toString('utf8') === BACKUP_MAGIC
}

export function readBackupHeader(buffer: Buffer): BackupArchiveHeader {
  if (!looksLikeBackupArchive(buffer)) throw new Error('不是 everydaytool 备份包（magic 不匹配）')
  const version = buffer.readUInt8(4)
  if (version > BACKUP_FORMAT_VERSION) {
    throw new Error(`备份包版本 ${version} 高于当前应用支持的 ${BACKUP_FORMAT_VERSION}，请升级应用后再恢复`)
  }
  const flags = buffer.readUInt8(5)
  return { version, encrypted: (flags & 1) === 1, needsPassword: (flags & 1) === 1 }
}

function encodeFileTable(files: BackupFileRecord[]): Buffer {
  const chunks: Buffer[] = []
  const header = Buffer.alloc(4)
  header.writeUInt32BE(files.length, 0)
  chunks.push(header)
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    if (name.length > MAX_NAME_BYTES) throw new Error(`备份包条目名过长：${file.name.slice(0, 64)}…`)
    const nameLength = Buffer.alloc(2)
    nameLength.writeUInt16BE(name.length, 0)
    const dataLength = Buffer.alloc(4)
    dataLength.writeUInt32BE(file.data.length, 0)
    chunks.push(nameLength, name, dataLength, Buffer.from(file.data))
  }
  return Buffer.concat(chunks)
}

function decodeFileTable(table: Buffer): BackupFileRecord[] {
  if (table.length < 4) throw new Error('备份包内容损坏（缺少条目表头）')
  const count = table.readUInt32BE(0)
  if (count === 0 || count > MAX_FILE_COUNT) throw new Error('备份包条目数异常')

  const files: BackupFileRecord[] = []
  let offset = 4
  for (let index = 0; index < count; index++) {
    if (offset + 2 > table.length) throw new Error('备份包内容截断（条目名长度）')
    const nameLength = table.readUInt16BE(offset)
    offset += 2
    if (offset + nameLength + 4 > table.length) throw new Error('备份包内容截断（条目名）')
    const name = table.subarray(offset, offset + nameLength).toString('utf8')
    offset += nameLength
    const dataLength = table.readUInt32BE(offset)
    offset += 4
    if (offset + dataLength > table.length) throw new Error('备份包内容截断（条目数据）')
    files.push({ name, data: table.subarray(offset, offset + dataLength) })
    offset += dataLength
  }
  return files
}

/** 打包：manifest 作为首个条目，文件按 `${layer}/${relativePath}` 命名 */
export function encodeBackupArchive(content: BackupArchiveContent, options: { password?: string } = {}): Buffer {
  const manifest: BackupManifest = { ...content.manifest, encrypted: Boolean(options.password) }
  const files: BackupFileRecord[] = [
    { name: MANIFEST_ENTRY_NAME, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') },
    ...content.files,
  ]

  let payload = gzipSync(encodeFileTable(files), { level: 6 })
  const password = options.password?.trim()
  let flags = 0
  let cryptoHeader: CryptoHeader = {}

  if (password) {
    const salt = randomBytes(KDF.saltLength)
    const iv = randomBytes(IV_LENGTH)
    const key = scryptSync(password, salt, KDF.keyLength, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 64 * 1024 * 1024 })
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()])
    payload = encrypted
    flags |= 1
    cryptoHeader = {
      kdf: 'scrypt',
      n: KDF.N,
      r: KDF.r,
      p: KDF.p,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
    }
  }

  const headerBuffer = Buffer.from(JSON.stringify(cryptoHeader), 'utf8')
  if (headerBuffer.length > MAX_HEADER_BYTES) throw new Error('备份包头部过大')

  const prefix = Buffer.alloc(10)
  prefix.write(BACKUP_MAGIC, 0, 'utf8')
  prefix.writeUInt8(BACKUP_FORMAT_VERSION, 4)
  prefix.writeUInt8(flags, 5)
  prefix.writeUInt32BE(headerBuffer.length, 6)
  return Buffer.concat([prefix, headerBuffer, payload])
}

/** 解包：需要口令的包必须提供口令，否则抛「需要口令」错（UI 据此再弹输入框） */
export function decodeBackupArchive(buffer: Buffer, options: { password?: string } = {}): BackupArchiveContent {
  const header = readBackupHeader(buffer)
  const headerLength = buffer.readUInt32BE(6)
  if (headerLength > MAX_HEADER_BYTES) throw new Error('备份包头部异常')
  const headerStart = 10
  const payloadStart = headerStart + headerLength
  if (payloadStart > buffer.length) throw new Error('备份包内容截断（头部）')

  let payload = buffer.subarray(payloadStart)
  if (header.encrypted) {
    const password = options.password?.trim()
    if (!password) throw new Error('备份包已加密，需要口令')
    let cryptoHeader: CryptoHeader = {}
    try {
      const parsed: unknown = JSON.parse(buffer.subarray(headerStart, payloadStart).toString('utf8'))
      if (isRecord(parsed)) cryptoHeader = parsed as CryptoHeader
    } catch {
      throw new Error('备份包头部损坏')
    }
    if (!cryptoHeader.salt || !cryptoHeader.iv) throw new Error('备份包缺少加密参数')
    const salt = Buffer.from(cryptoHeader.salt, 'base64')
    const iv = Buffer.from(cryptoHeader.iv, 'base64')
    if (iv.length !== IV_LENGTH) throw new Error('备份包加密参数异常')
    const key = scryptSync(password, salt, KDF.keyLength, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 64 * 1024 * 1024 })
    const tag = payload.subarray(payload.length - 16)
    const body = payload.subarray(0, payload.length - 16)
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      payload = Buffer.concat([decipher.update(body), decipher.final()])
    } catch {
      // GCM 校验失败通常是口令错误；不要把口令写进日志
      throw new Error('口令不正确或备份包已损坏')
    }
  }

  let table: Buffer
  try {
    table = gunzipSync(payload)
  } catch {
    throw new Error('备份包内容损坏（解压失败）')
  }

  const files = decodeFileTable(table)
  const manifestRecord = files.shift()
  if (!manifestRecord || manifestRecord.name !== MANIFEST_ENTRY_NAME) throw new Error('备份包缺少 manifest.json')
  let manifest: BackupManifest
  try {
    manifest = JSON.parse(Buffer.from(manifestRecord.data).toString('utf8')) as BackupManifest
  } catch {
    throw new Error('备份包 manifest.json 解析失败')
  }
  logger.info('Backup archive decoded', { entries: manifest.entries.length, files: files.length })
  return { manifest, files }
}
