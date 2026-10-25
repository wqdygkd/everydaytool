// M3-B：MTProto 消息媒体下载（teleproto）。
//
// 安全边界：
// - api_id / api_hash / session 只在主进程从环境或 .env 读取，绝不写日志、绝不发往渲染层；
// - 只允许 t.me / telegram.me 的消息链接；拒绝邀请链接与任意 peer 字符串；
// - 只能访问当前登录账号本来就能访问的消息（不绕过 Telegram 访问控制）；
// - 文件写入数据根目录，消息正文只写进用户主动触发的归档清单。
//
// 下载语义：
// - 用 client.iterDownload(file, { offset, limit, requestSize, signal }) 从已提交偏移续传；
// - 每块写入后才更新哈希与 committed，崩溃后最多丢最后一个 flush 周期；
// - 完成后校验总大小并计算 SHA-256，再原子提交到 objects/，最后复制为归档副本；
// - 文件引用过期（FILE_REFERENCE_EXPIRED）时重新拉取消息并重试一次。
import type { TelegramMtprotoAccount, TelegramMtprotoStatus, TelegramMtprotoTask } from '../../../../shared/telegram-cache.ts'
import type { TelegramResourceRecord } from '../store/resource-registry.ts'
import type { ParsedMessageLink } from './mtproto-link.ts'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { TELEGRAM_CACHE_IPC_CHANNELS } from '../ipc/channels.ts'
import {
  getTelegramResourceRecord,
  isVerifiedCompleteRecord,
  recordTelegramContent,
  resolveTelegramObjectPath,
} from '../store/resource-registry.ts'
import { readMtprotoConfig } from '../utils/env.ts'
import {
  getTelegramArchiveRoot,
  getTelegramCacheRoot,
  getTelegramObjectsDir,
  getTelegramTmpDir,
  toTelegramRelativePath,
} from '../utils/paths.ts'
import { clearSecureSession, isSessionEncryptionAvailable, writeSecureSession } from '../utils/session-store.ts'
import { archiveTelegramResource } from './archive-service.ts'
import { hashFilePrefix, runChunkedDownload } from './mtproto-download-core.ts'
import { parseMessageLink } from './mtproto-link.ts'

const require = createRequire(import.meta.url)

const PARTIAL_SCHEMA = 1
const REQUEST_SIZE = 256 * 1024
const MAX_TEXT_CHARS = 20_000
const EMIT_THROTTLE_MS = 400

export class MtprotoError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'MtprotoError'
    this.code = code
  }
}

interface TgFileLike {
  size?: unknown
  mimeType?: string
  name?: string
}

interface TgMessageLike {
  id: number
  date?: number
  editDate?: number
  message?: string
  media?: unknown
  photo?: { id?: unknown }
  document?: { id?: unknown, size?: unknown, mimeType?: string }
  video?: unknown
  audio?: unknown
  voice?: unknown
  file?: TgFileLike
  peerId?: { channelId?: unknown, chatId?: unknown, userId?: unknown }
  noforwards?: boolean
}

interface TgDialogLike {
  entity?: { id?: unknown }
}

interface TgMeLike {
  id?: unknown
  username?: string
  firstName?: string
}

interface TgClient {
  connect: () => Promise<boolean>
  disconnect: () => Promise<void>
  isUserAuthorized: () => Promise<boolean>
  getMe: () => Promise<TgMeLike>
  getEntity: (entity: string) => Promise<unknown>
  getDialogs: (params: { limit: number }) => Promise<TgDialogLike[]>
  getMessages: (entity: unknown, params: { ids: number }) => Promise<TgMessageLike[]>
  iterDownload: (file: unknown, params?: {
    offset?: number
    limit?: number
    requestSize?: number
    signal?: AbortSignal
  }) => AsyncIterable<Uint8Array>
}

interface MediaInfo {
  kind: string
  size: number | null
  mimeType: string
  fileName: string
  fingerprint: string
}

interface PartialState {
  schemaVersion: number
  key: string
  fingerprint: string
  totalSize: number
  committed: number
  updatedAt: number
}

let client: TgClient | null = null
let connected = false
let account: TelegramMtprotoAccount | null = null
let lastError: string | undefined
let active: { task: TelegramMtprotoTask, controller: AbortController } | null = null
let lastTask: TelegramMtprotoTask | null = null
let lastEmitAt = 0
let teleprotoVersion: string | null | undefined

function loadTeleproto(): typeof import('teleproto') {
  return require('teleproto') as typeof import('teleproto')
}

function getTeleprotoVersion(): string | null {
  if (teleprotoVersion !== undefined) return teleprotoVersion
  try {
    const pkgPath = require.resolve('teleproto/package.json')
    const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown }
    teleprotoVersion = typeof raw.version === 'string' ? raw.version : null
  } catch {
    teleprotoVersion = null
  }
  return teleprotoVersion
}

function toSafeNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null
  if (typeof value === 'bigint') {
    const num = Number(value)
    return Number.isSafeInteger(num) ? num : null
  }
  if (typeof value === 'object' && value !== null) {
    const num = Number(String(value))
    return Number.isSafeInteger(num) && num >= 0 ? num : null
  }
  return null
}

function sanitizeFileName(name: string | undefined, fallback: string): string {
  const base = typeof name === 'string' ? name.trim() : ''
  if (!base) return fallback
  return base.replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120) || fallback
}

function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'application/pdf': 'pdf',
  }
  return map[mimeType] ?? 'bin'
}

function describeMedia(message: TgMessageLike): MediaInfo | null {
  const kind = message.photo
    ? 'photo'
    : message.video
      ? 'video'
      : message.audio
        ? 'audio'
        : message.voice
          ? 'voice'
          : message.document
            ? 'document'
            : null
  if (!kind || !message.media) return null
  const size = toSafeNumber(message.file?.size) ?? toSafeNumber(message.document?.size)
  const mimeType = message.file?.mimeType ?? message.document?.mimeType ?? (kind === 'photo' ? 'image/jpeg' : 'application/octet-stream')
  const fallbackName = `${kind}-${message.id}.${extensionFor(mimeType)}`
  const fileName = sanitizeFileName(message.file?.name, fallbackName)
  const mediaId = kind === 'photo' ? String(message.photo?.id ?? '') : String(message.document?.id ?? '')
  return {
    kind,
    size,
    mimeType,
    fileName,
    fingerprint: `${kind}:${mediaId || 'noid'}:${size ?? 'unknown'}`,
  }
}

function buildResourceKey(accountId: string, peerKey: string, messageId: number, kind: string): string {
  return `tg:v1:${accountId}:${peerKey}:${messageId}:${kind}`.slice(0, 200)
}

function isFileReferenceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /FILE_REFERENCE|file reference/i.test(message)
}

function failMessage(error: unknown): string {
  if (error instanceof MtprotoError) return error.message
  const message = error instanceof Error ? error.message : String(error)
  if (isFileReferenceError(error)) return '文件引用已过期，且刷新后仍失败；请稍后重试'
  return message
}

export function getMtprotoStatus(): TelegramMtprotoStatus {
  const config = readMtprotoConfig()
  return {
    configured: config.configured,
    hasSession: config.hasSession,
    connected,
    account,
    missing: config.missing,
    libVersion: getTeleprotoVersion(),
    sessionSource: config.sessionSource,
    encryptionAvailable: config.encryptionAvailable,
    error: lastError,
    active: active?.task ?? null,
    lastTask,
  }
}

function emitStatus(force = false): void {
  const now = Date.now()
  if (!force && now - lastEmitAt < EMIT_THROTTLE_MS) return
  lastEmitAt = now
  broadcastToWindows(TELEGRAM_CACHE_IPC_CHANNELS.EVENT_MTPROTO, getMtprotoStatus(), {
    onError: error => logger.warn('MTProto status broadcast failed', { error: error.message }),
  })
}

async function ensureClient(): Promise<TgClient> {
  const config = readMtprotoConfig()
  if (!config.value) {
    throw new MtprotoError('MT_CONFIG', `MTProto 凭据不完整：缺少 ${config.missing.join(' / ')}`)
  }
  if (client && connected) return client

  const gp = loadTeleproto()
  let instance: unknown
  try {
    instance = new gp.TelegramClient(
      new gp.sessions.StringSession(config.value.session),
      config.value.apiId,
      config.value.apiHash,
      {
        connectionRetries: 2,
        autoReconnect: false,
        // teleproto 用 transport 取代 GramJS 的 useWSS；保持 WSS 以兼容受限网络
        transport: new gp.WebSocketTransport(),
        deviceModel: 'everydaytool',
        systemVersion: process.platform,
        appVersion: '1.7.0',
        langCode: 'zh',
      },
    )
    const typed = instance as TgClient
    await typed.connect()
    if (!await typed.isUserAuthorized()) {
      await typed.disconnect().catch(() => {})
      throw new MtprotoError('MT_SESSION', '会话无效或已失效：请重新运行 pnpm telegram:session 并更新 .env')
    }
    const me = await typed.getMe()
    client = typed
    connected = true
    account = {
      id: String(me.id ?? ''),
      username: me.username,
      firstName: me.firstName,
    }
    lastError = undefined
    emitStatus(true)
    logger.info('MTProto connected', { account: account.id })
    // 首次用 .env 明文连接成功后，自动迁移到 OS 加密存储（失败不回滚连接）
    if (config.value.sessionSource === 'env' && isSessionEncryptionAvailable()) {
      if (writeSecureSession(config.value.session)) {
        logger.info('MTProto session migrated to encrypted storage')
      } else {
        logger.warn('MTProto session migration failed; keeping .env fallback')
      }
    }
    return typed
  } catch (error) {
    connected = false
    client = null
    account = null
    lastError = failMessage(error)
    try {
      if (instance) await (instance as TgClient).disconnect()
    } catch {
      // 忽略
    }
    throw error
  }
}

async function resolveEntity(typed: TgClient, parsed: ParsedMessageLink): Promise<{ entity: unknown, peerKey: string }> {
  if (parsed.username) {
    const entity = await typed.getEntity(parsed.username)
    return { entity, peerKey: parsed.username }
  }
  const channelId = parsed.channelId
  if (!channelId) throw new MtprotoError('MT_LINK', '无法解析频道 ID')
  for (const candidate of [`-100${channelId}`, channelId]) {
    try {
      const entity = await typed.getEntity(candidate)
      return { entity, peerKey: candidate }
    } catch {
      // 继续尝试
    }
  }
  // 私密链接的 access hash 只能从会话实体缓存里拿：先枚举一次对话
  const dialogs = await typed.getDialogs({ limit: 200 })
  const found = dialogs.find((dialog) => {
    const id = dialog.entity?.id
    const text = id === undefined || id === null ? '' : String(id)
    return text === `-100${channelId}` || text === channelId
  })
  if (!found?.entity) {
    throw new MtprotoError('MT_PEER', '找不到该频道：请确认账号已加入，并先在对话列表里打开一次')
  }
  return { entity: found.entity, peerKey: `-100${channelId}` }
}

async function resolveMessage(typed: TgClient, parsed: ParsedMessageLink): Promise<{ message: TgMessageLike, peerKey: string }> {
  const { entity, peerKey } = await resolveEntity(typed, parsed)
  const messages = await typed.getMessages(entity, { ids: parsed.messageId })
  const message = messages?.[0]
  if (!message) throw new MtprotoError('MT_MESSAGE', '找不到该消息（可能已删除或无权访问）')
  if (message.noforwards) throw new MtprotoError('MT_PROTECTED', '该消息标记为禁止转发 / 保存，已拒绝下载')
  if (!describeMedia(message)) throw new MtprotoError('MT_MEDIA', '该消息不包含可下载的媒体')
  return { message, peerKey }
}

function partialDir(): string {
  return path.join(getTelegramCacheRoot(), 'mtproto', 'partial')
}

function partialPathFor(key: string): string {
  const digest = createHash('sha1').update(key).digest('hex')
  return path.join(partialDir(), `${digest}.json`)
}

async function loadPartial(filePath: string): Promise<PartialState | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as PartialState
    if (parsed.schemaVersion !== PARTIAL_SCHEMA) return null
    if (typeof parsed.key !== 'string' || typeof parsed.fingerprint !== 'string') return null
    if (!Number.isSafeInteger(parsed.totalSize) || parsed.totalSize <= 0) return null
    if (!Number.isSafeInteger(parsed.committed) || parsed.committed < 0) return null
    return parsed
  } catch {
    return null
  }
}

async function savePartial(filePath: string, state: PartialState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(tmp, filePath)
}

async function writeMessageManifest(entryPath: string, input: {
  link: string
  peerKey: string
  message: TgMessageLike
  media: MediaInfo
  sha256: string
  savedAt: number
}): Promise<void> {
  const archiveId = `res-${input.sha256.slice(0, 16)}`
  const dir = path.join(getTelegramArchiveRoot(), 'resources', archiveId)
  await mkdir(dir, { recursive: true })
  const text = (input.message.message ?? '').slice(0, MAX_TEXT_CHARS)
  const payload = {
    schemaVersion: 1,
    archiveId,
    source: 'telegram-mtproto',
    link: input.link,
    peer: input.peerKey,
    messageId: input.message.id,
    date: input.message.date ? new Date(input.message.date * 1000).toISOString() : null,
    editDate: input.message.editDate ? new Date(input.message.editDate * 1000).toISOString() : null,
    text,
    textTruncated: (input.message.message ?? '').length > MAX_TEXT_CHARS,
    fileName: input.media.fileName,
    mimeType: input.media.mimeType,
    size: input.media.size,
    sha256: input.sha256,
    savedAt: new Date(input.savedAt).toISOString(),
    relativeContentPath: toTelegramRelativePath(entryPath),
  }
  await writeFile(path.join(dir, 'message.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function objectPathForDigest(digest: string): string {
  return path.join(getTelegramObjectsDir(), digest.slice(0, 2), digest)
}

async function runDownload(task: TelegramMtprotoTask, parsed: ParsedMessageLink, signal: AbortSignal): Promise<void> {
  let resumeInfo: { key: string, fingerprint: string, totalSize: number, state: { committed: number } } | null = null
  try {
    const typed = await ensureClient()
    task.phase = 'resolving'
    task.updatedAt = Date.now()
    emitStatus(true)

    let resolved = await resolveMessage(typed, parsed)
    let message = resolved.message
    let peerKey = resolved.peerKey
    const media = describeMedia(message)
    if (!media) throw new MtprotoError('MT_MEDIA', '该消息不包含可下载的媒体')
    if (media.size === null || media.size <= 0) {
      throw new MtprotoError('MT_SIZE', '无法确定媒体大小，暂不支持该媒体类型')
    }

    task.messageId = message.id
    task.fileName = media.fileName
    task.mimeType = media.mimeType
    task.totalBytes = media.size
    task.updatedAt = Date.now()
    emitStatus(true)

    const accountId = account?.id ?? 'unknown'
    const key = buildResourceKey(accountId, peerKey, message.id, media.kind)
    const displayUrl = `tg://${peerKey}/${message.id}`

    const existing = getTelegramResourceRecord(key)
    if (existing && isVerifiedCompleteRecord(existing)
      && existing.sourceMeta?.mtprotoFingerprint === media.fingerprint
      && existing.sha256) {
      const objectPath = resolveTelegramObjectPath(existing)
      if (objectPath && existsSync(objectPath)) {
        task.phase = 'archiving'
        emitStatus(true)
        const entry = await archiveTelegramResource(existing)
        await writeMessageManifest(objectPath, {
          link: task.link,
          peerKey,
          message,
          media,
          sha256: existing.sha256,
          savedAt: Date.now(),
        })
        task.bytes = existing.actualSize ?? media.size
        task.sha256 = existing.sha256
        task.archiveRelativePath = entry.relativePath
        task.phase = 'completed'
        task.updatedAt = Date.now()
        emitStatus(true)
        return
      }
    }

    const statePath = partialPathFor(key)
    // 临时文件必须按资源键稳定命名：按 taskId 命名会让重启/重试后找不到上次的 .part
    const tmpName = createHash('sha1').update(key).digest('hex')
    const tmpPath = path.join(getTelegramTmpDir(), `mt-${tmpName}.part`)
    await mkdir(getTelegramTmpDir(), { recursive: true })

    let committed = 0
    const partial = await loadPartial(statePath)
    if (partial && partial.key === key && partial.fingerprint === media.fingerprint && partial.totalSize === media.size) {
      committed = Math.min(partial.committed, media.size)
    }
    if (committed > 0) {
      const info = await stat(tmpPath).catch(() => null)
      if (!info || info.size < committed) committed = 0
    }
    if (committed === 0) {
      await rm(tmpPath, { force: true })
      await rm(statePath, { force: true })
    } else {
      await truncate(tmpPath, committed)
    }

    task.resumedFrom = committed
    task.bytes = committed
    task.updatedAt = Date.now()

    const hash = createHash('sha256')
    await hashFilePrefix(tmpPath, committed, hash)

    const total = media.size
    const downloadState = { committed }
    resumeInfo = {
      key,
      fingerprint: media.fingerprint,
      totalSize: total,
      state: downloadState,
    }
    let attempts = 0
    while (committed < total) {
      try {
        committed = await runChunkedDownload({
          tmpPath,
          totalSize: total,
          hash,
          state: downloadState,
          signal,
          createIterator: (offset, limit) => typed.iterDownload(message.media, {
            offset,
            limit,
            requestSize: REQUEST_SIZE,
            signal,
          }),
          onProgress: (bytes) => {
            task.bytes = bytes
            task.updatedAt = Date.now()
            emitStatus()
          },
          flush: async (bytes) => {
            await savePartial(statePath, {
              schemaVersion: PARTIAL_SCHEMA,
              key,
              fingerprint: media.fingerprint,
              totalSize: total,
              committed: bytes,
              updatedAt: Date.now(),
            })
          },
        })
        break
      } catch (error) {
        committed = downloadState.committed
        // 把文件截断到最后一次确认写入的偏移，避免重试时把半块数据重复追加
        await truncate(tmpPath, committed).catch(() => {})
        if (attempts < 1 && isFileReferenceError(error)) {
          attempts += 1
          resolved = await resolveMessage(typed, parsed)
          message = resolved.message
          peerKey = resolved.peerKey
          const refreshed = describeMedia(message)
          if (!refreshed || refreshed.size === null || refreshed.size !== total) {
            throw new MtprotoError('MT_REFERENCE', '刷新文件引用后媒体大小变化，已停止（避免拼接错误内容）')
          }
          continue
        }
        throw error
      }
    }

    if (signal.aborted) {
      await savePartial(statePath, {
        schemaVersion: PARTIAL_SCHEMA,
        key,
        fingerprint: media.fingerprint,
        totalSize: total,
        committed: downloadState.committed,
        updatedAt: Date.now(),
      })
      task.phase = 'cancelled'
      task.error = '已取消（保留断点，可重试续传）'
      task.updatedAt = Date.now()
      emitStatus(true)
      return
    }

    task.phase = 'verifying'
    task.updatedAt = Date.now()
    emitStatus(true)
    const info = await stat(tmpPath)
    if (info.size !== total || downloadState.committed !== total) {
      throw new MtprotoError('MT_INCOMPLETE', `下载不完整：期望 ${total} 字节，实际 ${info.size}`)
    }
    const digest = hash.digest('hex')

    const finalPath = objectPathForDigest(digest)
    await mkdir(path.dirname(finalPath), { recursive: true })
    if (existsSync(finalPath)) await rm(tmpPath, { force: true })
    else await rename(tmpPath, finalPath)

    const record: TelegramResourceRecord = recordTelegramContent({
      resourceKey: key,
      sourceType: 'telegram-mtproto',
      displayUrl,
      host: 'telegram',
      mimeType: media.mimeType,
      expectedSize: total,
      actualSize: total,
      sha256: digest,
      relativePath: toTelegramRelativePath(finalPath),
      sourceMeta: { mtprotoFingerprint: media.fingerprint },
    })

    task.phase = 'archiving'
    task.sha256 = digest
    task.updatedAt = Date.now()
    emitStatus(true)
    const entry = await archiveTelegramResource(record)
    await writeMessageManifest(finalPath, {
      link: task.link,
      peerKey,
      message,
      media,
      sha256: digest,
      savedAt: Date.now(),
    })
    await rm(statePath, { force: true }).catch(() => {})

    task.bytes = total
    task.archiveRelativePath = entry.relativePath
    task.phase = 'completed'
    task.error = undefined
    task.updatedAt = Date.now()
    emitStatus(true)
    logger.info('MTProto media downloaded', { messageId: message.id, size: total, sha256: digest.slice(0, 12) })
  } catch (error) {
    // 失败 / 取消时保留断点：已写入文件的连续前缀可用于下次续传
    const committed = resumeInfo?.state.committed ?? 0
    if (resumeInfo && committed > 0) {
      task.bytes = committed
      await savePartial(partialPathFor(resumeInfo.key), {
        schemaVersion: PARTIAL_SCHEMA,
        key: resumeInfo.key,
        fingerprint: resumeInfo.fingerprint,
        totalSize: resumeInfo.totalSize,
        committed,
        updatedAt: Date.now(),
      }).catch(() => {})
    }
    task.phase = signal.aborted ? 'cancelled' : 'failed'
    task.error = signal.aborted ? '已取消（保留断点，可重试续传）' : failMessage(error)
    task.updatedAt = Date.now()
    lastError = task.phase === 'failed' ? task.error : lastError
    emitStatus(true)
    if (task.phase === 'failed') logger.warn('MTProto download failed', { error: task.error })
  } finally {
    lastTask = task
    active = null
    emitStatus(true)
  }
}

export function beginMtprotoDownload(link: unknown): { taskId: string } {
  if (typeof link !== 'string' || !link.trim()) throw new MtprotoError('MT_LINK', '消息链接不能为空')
  const parsed = parseMessageLink(link)
  if (!parsed) throw new MtprotoError('MT_LINK', '链接格式不支持：只接受 https://t.me/<name>/<id> 或 https://t.me/c/<channelId>/<id>')
  if (active) throw new MtprotoError('MT_BUSY', '已有 MTProto 下载任务在进行')
  const config = readMtprotoConfig()
  if (!config.value) throw new MtprotoError('MT_CONFIG', `MTProto 凭据不完整：缺少 ${config.missing.join(' / ')}`)

  const task: TelegramMtprotoTask = {
    taskId: `mt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    phase: 'resolving',
    link: link.trim(),
    bytes: 0,
    totalBytes: null,
    resumedFrom: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  }
  const controller = new AbortController()
  active = { task, controller }
  emitStatus(true)
  void runDownload(task, parsed, controller.signal)
  return { taskId: task.taskId }
}

export function cancelMtprotoDownload(): boolean {
  if (!active) return false
  active.task.phase = 'cancelled'
  active.task.error = '正在取消…'
  active.task.updatedAt = Date.now()
  active.controller.abort()
  emitStatus(true)
  return true
}

/** 把当前 .env 明文会话迁移到 OS 加密存储（安全存储不可用时明确报错，不静默降级） */
export function migrateSessionToSecureStorage(): TelegramMtprotoStatus {
  const config = readMtprotoConfig()
  if (!config.value || config.value.sessionSource !== 'env') {
    throw new MtprotoError('MT_SESSION', '当前没有 .env 明文会话可迁移')
  }
  if (!isSessionEncryptionAvailable()) {
    throw new MtprotoError('MT_NO_CRYPTO', '当前平台不支持安全存储（safeStorage 不可用）')
  }
  if (!writeSecureSession(config.value.session)) {
    throw new MtprotoError('MT_NO_CRYPTO', '写入加密会话失败')
  }
  logger.info('MTProto session migrated on demand')
  emitStatus(true)
  return getMtprotoStatus()
}

/** 清除本工具的加密会话并断开；.env 中的会话不受影响（如有会继续回退使用） */
export function clearSecureSessionStorage(): TelegramMtprotoStatus {
  clearSecureSession()
  if (client) {
    void client.disconnect().catch(() => {})
    client = null
  }
  connected = false
  account = null
  lastError = undefined
  emitStatus(true)
  logger.info('MTProto encrypted session cleared')
  return getMtprotoStatus()
}

export function disposeMtproto(): void {
  try {
    active?.controller.abort()
  } catch {
    // 忽略
  }
  active = null
  if (client) {
    void client.disconnect().catch(() => {})
    client = null
  }
  connected = false
  account = null
}

/** 供可行性报告使用：当前 MTProto 配置状态（不连接、不读值到日志） */
export function describeMtprotoConfig(): { configured: boolean, hasSession: boolean, connected: boolean, missing: string[] } {
  const config = readMtprotoConfig()
  return {
    configured: config.configured,
    hasSession: config.hasSession,
    connected,
    missing: config.missing,
  }
}
