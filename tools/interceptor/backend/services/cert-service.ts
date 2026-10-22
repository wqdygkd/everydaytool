// 根 CA 与叶证书的生成 / 管理（node-forge，纯 JS，不依赖系统 OpenSSL）。
// 方案见 docs/interceptor.md §6：RSA 2048、SHA-256、根 CA 10 年、
// 叶证书按域名现场签发（内存缓存，SAN 含 DNS 与 IP），查/删统一走 SHA1 指纹。
import type forgeTypes from 'node-forge'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import forge from 'node-forge'
import { ensureDir, pathExists } from '../../../../backend/utils/file-ops.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { getCaCertPath, getCaKeyPath, getCertsDirectory } from '../utils/paths.ts'

const ROOT_CA_COMMON_NAME = 'edt Interceptor CA'
const ROOT_CA_ORGANIZATION = 'everydaytool'
const ROOT_CA_VALIDITY_DAYS = 3650
/** 叶证书有效期：控制在 398 天平台硬限内（397 天），过期由缓存自动重签 */
const LEAF_VALIDITY_DAYS = 397
/** 剩余有效期不足该天数时视为需要重签（根 CA 与叶证书共用） */
const RENEW_THRESHOLD_DAYS = 30

export interface RootCaInfo {
  privateKey: forgeTypes.pki.rsa.PrivateKey
  certPem: string
  cert: forgeTypes.pki.Certificate
  fingerprint: string
  commonName: string
  expiresAt: number
}

export interface LeafCertificate {
  keyPem: string
  certPem: string
  expiresAt: number
}

function sha1Fingerprint(cert: forgeTypes.pki.Certificate): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()
  return createHash('sha1').update(Buffer.from(der, 'binary')).digest('hex').toUpperCase()
}

function makeSerialNumber(): string {
  // 16 字节随机序列号（首字节 < 0x80 避免被解析为负数）
  const bytes = forge.random.getBytesSync(16)
  const first = bytes.charCodeAt(0) & 0x7F
  return forge.util.bytesToHex(String.fromCharCode(first) + bytes.slice(1))
}

function isExpiringSoon(notAfter: Date, thresholdDays = RENEW_THRESHOLD_DAYS): boolean {
  return notAfter.getTime() - Date.now() < thresholdDays * 24 * 60 * 60 * 1000
}

function generateRootCa(): RootCaInfo {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = makeSerialNumber()
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000)
  cert.validity.notAfter = new Date(Date.now() + ROOT_CA_VALIDITY_DAYS * 24 * 60 * 60 * 1000)

  const attrs = [
    { name: 'commonName', value: ROOT_CA_COMMON_NAME },
    { name: 'organizationName', value: ROOT_CA_ORGANIZATION },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, cRLSign: true },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())

  return {
    privateKey: keys.privateKey,
    certPem: forge.pki.certificateToPem(cert),
    cert,
    fingerprint: sha1Fingerprint(cert),
    commonName: ROOT_CA_COMMON_NAME,
    expiresAt: cert.validity.notAfter.getTime(),
  }
}

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

function generateLeafCertificate(root: RootCaInfo, host: string): LeafCertificate {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = makeSerialNumber()
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000)
  cert.validity.notAfter = new Date(Date.now() + LEAF_VALIDITY_DAYS * 24 * 60 * 60 * 1000)

  cert.setSubject([{ name: 'commonName', value: host }])
  cert.setIssuer(root.cert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: [
        isIpAddress(host)
          ? { type: 7, ip: host }
          : { type: 2, value: host },
      ],
    },
  ])
  cert.sign(root.privateKey, forge.md.sha256.create())

  return {
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certPem: forge.pki.certificateToPem(cert),
    expiresAt: cert.validity.notAfter.getTime(),
  }
}

const leafCache = new Map<string, LeafCertificate>()

let rootCa: RootCaInfo | null = null
let rootCaLoading: Promise<RootCaInfo> | null = null

async function loadRootCaFromDisk(): Promise<RootCaInfo | null> {
  const [keyPath, certPath] = [getCaKeyPath(), getCaCertPath()]
  if (!await pathExists(keyPath) || !await pathExists(certPath)) return null

  try {
    const [keyPem, certPem] = await Promise.all([
      readFile(keyPath, 'utf8'),
      readFile(certPath, 'utf8'),
    ])
    const cert = forge.pki.certificateFromPem(certPem)
    return {
      privateKey: forge.pki.privateKeyFromPem(keyPem) as unknown as forgeTypes.pki.rsa.PrivateKey,
      certPem,
      cert,
      fingerprint: sha1Fingerprint(cert),
      commonName: ROOT_CA_COMMON_NAME,
      expiresAt: cert.validity.notAfter.getTime(),
    }
  } catch (error) {
    logger.warn('Failed to load root CA, will regenerate', { error: (error as Error).message })
    return null
  }
}

async function persistRootCa(info: RootCaInfo): Promise<void> {
  await ensureDir(getCertsDirectory())
  await writeFile(getCaKeyPath(), forge.pki.privateKeyToPem(info.privateKey), 'utf8')
  await writeFile(getCaCertPath(), info.certPem, 'utf8')
  // 私钥收紧权限；Windows 上为 no-op，失败不影响主流程
  await chmod(getCaKeyPath(), 0o600).catch(() => {})
}

/** 确保根 CA 存在（缺失或临期自动重新生成；重新生成后旧指纹失效，需重新安装信任） */
export function ensureRootCa(force = false): Promise<RootCaInfo> {
  if (rootCa && !force && !isExpiringSoon(new Date(rootCa.expiresAt))) {
    return Promise.resolve(rootCa)
  }
  if (rootCaLoading) return rootCaLoading

  rootCaLoading = (async () => {
    if (!force) {
      const loaded = await loadRootCaFromDisk()
      if (loaded && !isExpiringSoon(new Date(loaded.expiresAt))) {
        rootCa = loaded
        return loaded
      }
    }

    const generated = generateRootCa()
    await persistRootCa(generated)
    rootCa = generated
    leafCache.clear()
    logger.info('Root CA (re)generated', { fingerprint: generated.fingerprint })
    return generated
  })().finally(() => {
    rootCaLoading = null
  })

  return rootCaLoading
}

/** 根证书是否已生成（不触发生成） */
export async function isRootCaGenerated(): Promise<boolean> {
  return await pathExists(getCaKeyPath()) && await pathExists(getCaCertPath())
}

/** 读取已生成的根证书信息（不生成）；未生成返回 null */
export async function readRootCa(): Promise<RootCaInfo | null> {
  if (rootCa) return rootCa
  return loadRootCaFromDisk()
}

/** 按域名取叶证书（内存缓存；临期自动重签） */
export async function getLeafCertificate(host: string): Promise<LeafCertificate> {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '')
  const cached = leafCache.get(normalized)
  if (cached && !isExpiringSoon(new Date(cached.expiresAt))) return cached

  const root = await ensureRootCa()
  const leaf = generateLeafCertificate(root, normalized)
  leafCache.set(normalized, leaf)
  return leaf
}

export function clearLeafCache(): void {
  leafCache.clear()
}

/** 数据目录切换后丢弃全部证书缓存（文件按新目录重新加载） */
export function resetCertCaches(): void {
  rootCa = null
  rootCaLoading = null
  leafCache.clear()
}
