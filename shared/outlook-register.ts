import { OUTLOOK_REGISTER_PARTITION_PREFIX } from './webview.ts'

export { OUTLOOK_REGISTER_PARTITION_PREFIX }

export const OUTLOOK_REGISTER_TOOL_ID = 'outlook-register'

export const OUTLOOK_MAILBOX_URL = 'https://outlook.live.com/mail/0/'

export const OUTLOOK_DOMAINS = ['@outlook.com', '@hotmail.com'] as const
export type OutlookDomain = (typeof OUTLOOK_DOMAINS)[number]

export type OutlookAccountStatus = 'pending' | 'registered'

export interface OutlookProfile {
  firstName: string
  lastName: string
  /** 4 位年份，注册页只接受 1900–2010 左右的合理值 */
  birthYear: number
  /** 1–12 */
  birthMonth: number
  /** 1–28，避开各月天数差异 */
  birthDay: number
}

/** 正在填写的注册草稿：密码在磁盘上由 Electron 系统加密信封保护，只有主进程能解封 */
export interface OutlookDraft {
  id: string
  email: string
  password: string
  passwordReadable: boolean
  domain: OutlookDomain
  profile: OutlookProfile
  recoveryEmail: string
  createdAt: string
}

export interface OutlookAccount {
  id: string
  email: string
  domain: OutlookDomain
  profile: OutlookProfile
  recoveryEmail: string
  note: string
  status: OutlookAccountStatus
  createdAt: string
  updatedAt: string
  lastMailboxOpenedAt: string | null
  partition: string
}

export interface OutlookRegisterSettings {
  /** 新草稿默认使用的邮箱后缀 */
  domain: OutlookDomain
  /** 邮箱 webview 使用的代理；空字符串表示直连 */
  proxy: string
  /** 复杂密码生成规则；改规则不会自动替换已有草稿密码 */
  password: OutlookPasswordOptions
}

export interface OutlookPasswordOptions {
  /** 12 / 14 / 16，Microsoft 注册页的历史上限按 16 处理 */
  length: number
  uppercase: boolean
  lowercase: boolean
  digits: boolean
  symbols: boolean
}

export interface OutlookRegisterState {
  accounts: OutlookAccount[]
  draft: OutlookDraft | null
  settings: OutlookRegisterSettings
  /** 系统加密是否可用（不可用时密码只能明文落盘） */
  secretsAvailable: boolean
}

export interface OutlookMailboxSession {
  partition: string
  url: string
}

export interface OutlookMailboxPrepared {
  session: OutlookMailboxSession
  state: OutlookRegisterState
}

export interface OutlookRevealedPassword {
  password: string
  failed: boolean
}

/** 每个账号 / 草稿使用自己的 persist 分区，注册完成后登录态可直接用于收信 */
export function outlookPartition(id: string): string {
  const safeId = id.replace(/[^a-z0-9-]/gi, '')
  if (!safeId) throw new Error('账号 id 非法')
  return `${OUTLOOK_REGISTER_PARTITION_PREFIX}-${safeId}`
}

export function isOutlookDomain(value: unknown): value is OutlookDomain {
  return typeof value === 'string' && (OUTLOOK_DOMAINS as readonly string[]).includes(value)
}

export function isOutlookEmail(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const email = value.trim().toLowerCase()
  return /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?@(?:outlook|hotmail)\.com$/.test(email)
}

export function splitOutlookEmail(email: string): { local: string, domain: OutlookDomain } | null {
  if (!isOutlookEmail(email)) return null
  const [local, host] = email.trim().toLowerCase().split('@')
  return { local, domain: `@${host}` as OutlookDomain }
}

export function withOutlookDomain(email: string, domain: OutlookDomain): string {
  const local = email.split('@')[0]?.trim().toLowerCase()
  return local ? `${local}${domain}` : ''
}

const FIRST_NAMES = [
  'James',
  'Emma',
  'Liam',
  'Olivia',
  'Noah',
  'Ava',
  'Lucas',
  'Sophia',
  'Mason',
  'Isabella',
  'Ethan',
  'Mia',
  'Daniel',
  'Charlotte',
  'Henry',
  'Amelia',
  'Jack',
  'Harper',
  'Leo',
  'Evelyn',
  'Ryan',
  'Abigail',
  'Owen',
  'Emily',
] as const

const LAST_NAMES = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Rodriguez',
  'Martinez',
  'Hernandez',
  'Lopez',
  'Wilson',
  'Anderson',
  'Thomas',
  'Taylor',
  'Moore',
  'Jackson',
  'Martin',
  'Lee',
  'Perez',
  'Thompson',
  'White',
  'Harris',
] as const

const PASSWORD_LOWER = 'abcdefghijklmnopqrstuvwxyz'
const PASSWORD_UPPER = PASSWORD_LOWER.toUpperCase()
const PASSWORD_DIGITS = '0123456789'
const PASSWORD_SYMBOLS = '!@#$%^&*'
const EMAIL_CHARS = 'abcdefghijklmnopqrstuvwxyz'

export const OUTLOOK_PASSWORD_LENGTHS = [12, 14, 16] as const
export const OUTLOOK_PASSWORD_MIN_LENGTH = 8
export const OUTLOOK_PASSWORD_MAX_LENGTH = 16

function randomInt(maxExclusive: number): number {
  if (maxExclusive <= 0) return 0
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.getRandomValues) {
    const values = new Uint32Array(1)
    cryptoApi.getRandomValues(values)
    return values[0] % maxExclusive
  }
  return Math.floor(Math.random() * maxExclusive)
}

function randomBetween(min: number, max: number): number {
  return min + randomInt(max - min + 1)
}

function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)]
}

export function generateOutlookProfile(): OutlookProfile {
  return {
    firstName: pick(FIRST_NAMES),
    lastName: pick(LAST_NAMES),
    birthYear: randomBetween(1965, 2003),
    birthMonth: randomBetween(1, 12),
    birthDay: randomBetween(1, 28),
  }
}

function randomEmailLocalPart(): string {
  const length = randomBetween(12, 14)
  let result = EMAIL_CHARS[randomInt(EMAIL_CHARS.length)]
  for (let index = 1; index < length; index += 1) {
    // 少量数字让地址不像固定模板，但首字符保持字母
    result += randomInt(100) < 7
      ? String(randomInt(10))
      : EMAIL_CHARS[randomInt(EMAIL_CHARS.length)]
  }
  return result
}

export function defaultOutlookPasswordOptions(): OutlookPasswordOptions {
  return {
    length: 16,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
  }
}

function passwordClassCount(options: Pick<OutlookPasswordOptions, 'uppercase' | 'lowercase' | 'digits' | 'symbols'>): number {
  return Number(options.uppercase) + Number(options.lowercase) + Number(options.digits) + Number(options.symbols)
}

export function normalizeOutlookPasswordOptions(value: unknown): OutlookPasswordOptions {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const lengthValue = Number(record.length)
  const rawLength = Number.isFinite(lengthValue)
    ? Math.min(OUTLOOK_PASSWORD_MAX_LENGTH, Math.max(OUTLOOK_PASSWORD_MIN_LENGTH, Math.trunc(lengthValue)))
    : 16
  // 设置页只提供 12 / 14 / 16 三档，旧值或手改值就近收敛，避免下拉显示为空
  const candidates: readonly number[] = OUTLOOK_PASSWORD_LENGTHS
  const length = candidates.reduce(
    (best, item) => Math.abs(item - rawLength) < Math.abs(best - rawLength) ? item : best,
    candidates[0],
  )
  const options: OutlookPasswordOptions = {
    length,
    uppercase: record.uppercase !== false,
    lowercase: record.lowercase !== false,
    digits: record.digits !== false,
    symbols: record.symbols !== false,
  }
  // 少于三类字符就不算复杂密码；回退到默认全开
  return passwordClassCount(options) < 3 ? defaultOutlookPasswordOptions() : options
}

/** 自定义密码与生成密码共用同一套校验；返回 null 表示通过 */
export function validateOutlookPassword(value: string): string | null {
  if (typeof value !== 'string' || !value) return '密码不能为空'
  if (value.length < OUTLOOK_PASSWORD_MIN_LENGTH || value.length > OUTLOOK_PASSWORD_MAX_LENGTH) {
    return `密码长度需在 ${OUTLOOK_PASSWORD_MIN_LENGTH}–${OUTLOOK_PASSWORD_MAX_LENGTH} 位之间`
  }
  if (/\s/.test(value)) return '密码不能包含空格或换行'
  const classes = [
    /[A-Z]/,
    /[a-z]/,
    /\d/,
    /[^a-z0-9]/i,
  ].filter(pattern => pattern.test(value)).length
  if (classes < 3) return '至少包含大写、小写、数字、符号中的三类'
  return null
}

export function generateOutlookPassword(input?: OutlookPasswordOptions | number): string {
  const options = typeof input === 'number'
    ? normalizeOutlookPasswordOptions({ ...defaultOutlookPasswordOptions(), length: input })
    : normalizeOutlookPasswordOptions(input)
  const pools: string[] = []
  if (options.uppercase) pools.push(PASSWORD_UPPER)
  if (options.lowercase) pools.push(PASSWORD_LOWER)
  if (options.digits) pools.push(PASSWORD_DIGITS)
  if (options.symbols) pools.push(PASSWORD_SYMBOLS)
  if (!pools.length) pools.push(PASSWORD_LOWER)

  // 每个启用的字符类先各放一个，剩下按启用池随机补足，最后洗牌避免固定位置
  const chars = pools.map(pool => pool[randomInt(pool.length)])
  while (chars.length < options.length) {
    const pool = pools[randomInt(pools.length)]
    chars.push(pool[randomInt(pool.length)])
  }
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1)
    const value = chars[index]
    chars[index] = chars[swap]
    chars[swap] = value
  }
  return chars.join('')
}

export function generateOutlookIdentity(
  domain: OutlookDomain,
  existingEmails: readonly string[] = [],
  passwordOptions?: OutlookPasswordOptions,
): { email: string, local: string, domain: OutlookDomain, password: string, profile: OutlookProfile } {
  const taken = new Set(existingEmails.map(item => item.trim().toLowerCase()))
  let local = randomEmailLocalPart()
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!taken.has(`${local}${domain}`)) break
    local = randomEmailLocalPart()
  }
  return {
    email: `${local}${domain}`,
    local,
    domain,
    password: generateOutlookPassword(passwordOptions),
    profile: generateOutlookProfile(),
  }
}
