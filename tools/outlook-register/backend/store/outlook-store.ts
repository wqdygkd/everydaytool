import type {
  OutlookAccount,
  OutlookAccountStatus,
  OutlookDomain,
  OutlookDraft,
  OutlookProfile,
  OutlookRegisterSettings,
} from '../../../../shared/outlook-register.ts'
import { randomUUID } from 'node:crypto'
import { resolveLayerPath } from '../../../../backend/utils/data-layers.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { openSecretDetailed, sealSecret } from '../../../../backend/utils/secret-box.ts'
import {
  generateOutlookIdentity,
  isOutlookDomain,
  isOutlookEmail,
  normalizeOutlookPasswordOptions,
  OUTLOOK_DOMAINS,
  outlookPartition,
  validateOutlookPassword,
  withOutlookDomain,
} from '../../../../shared/outlook-register.ts'

interface StoredAccount {
  id: string
  email: string
  domain: OutlookDomain
  passwordSealed: string
  profile: OutlookProfile
  recoveryEmail: string
  note: string
  status: OutlookAccountStatus
  createdAt: string
  updatedAt: string
  lastMailboxOpenedAt: string | null
}

interface StoredDraft {
  id: string
  email: string
  domain: OutlookDomain
  passwordSealed: string
  profile: OutlookProfile
  recoveryEmail: string
  createdAt: string
}

interface AccountsDocument {
  schemaVersion: 1
  accounts: StoredAccount[]
}

interface DraftDocument {
  schemaVersion: 1
  draft: StoredDraft | null
}

interface SettingsDocument {
  schemaVersion: 1
  settings: OutlookRegisterSettings
}

function accountsPath(): string {
  return resolveLayerPath('config', 'outlook-register', 'accounts.json')
}

function draftPath(): string {
  return resolveLayerPath('config', 'outlook-register', 'draft.json')
}

function settingsPath(): string {
  return resolveLayerPath('config', 'outlook-register', 'settings.json')
}

function defaultSettings(): OutlookRegisterSettings {
  return {
    domain: '@outlook.com',
    proxy: '',
    password: normalizeOutlookPasswordOptions(undefined),
  }
}

function sanitizeProfile(value: unknown): OutlookProfile {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return {
    firstName: typeof record.firstName === 'string' ? record.firstName.trim().slice(0, 50) : 'Alex',
    lastName: typeof record.lastName === 'string' ? record.lastName.trim().slice(0, 50) : 'Taylor',
    birthYear: Number.isInteger(record.birthYear) ? Number(record.birthYear) : 1995,
    birthMonth: Number.isInteger(record.birthMonth) ? Number(record.birthMonth) : 6,
    birthDay: Number.isInteger(record.birthDay) ? Number(record.birthDay) : 15,
  }
}

function sanitizeStatus(value: unknown): OutlookAccountStatus {
  return value === 'pending' ? 'pending' : 'registered'
}

function sanitizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function sanitizeDomain(value: unknown, fallback: OutlookDomain): OutlookDomain {
  return isOutlookDomain(value) ? value : fallback
}

function readAccountsDocument(): AccountsDocument {
  const raw = readJsonDocument<Partial<AccountsDocument>>(accountsPath(), () => ({ schemaVersion: 1, accounts: [] }))
  const accounts: StoredAccount[] = []
  for (const item of Array.isArray(raw.accounts) ? raw.accounts : []) {
    if (!item || typeof item !== 'object') continue
    const record = item as unknown as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.replace(/[^a-z0-9-]/gi, '') : ''
    const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : ''
    if (!id || !isOutlookEmail(email)) continue
    const domain = sanitizeDomain(record.domain, email.endsWith('@hotmail.com') ? '@hotmail.com' : '@outlook.com')
    accounts.push({
      id,
      email,
      domain,
      passwordSealed: sanitizeString(record.passwordSealed),
      profile: sanitizeProfile(record.profile),
      recoveryEmail: sanitizeString(record.recoveryEmail).trim().slice(0, 254),
      note: sanitizeString(record.note).slice(0, 2000),
      status: sanitizeStatus(record.status),
      createdAt: sanitizeString(record.createdAt, new Date().toISOString()),
      updatedAt: sanitizeString(record.updatedAt, new Date().toISOString()),
      lastMailboxOpenedAt: typeof record.lastMailboxOpenedAt === 'string' ? record.lastMailboxOpenedAt : null,
    })
  }
  return { schemaVersion: 1, accounts }
}

function writeAccountsDocument(document: AccountsDocument): void {
  writeJsonDocument(accountsPath(), document)
}

function readDraftDocument(): DraftDocument {
  const raw = readJsonDocument<Partial<DraftDocument>>(draftPath(), () => ({ schemaVersion: 1, draft: null }))
  const value = raw.draft
  if (!value || typeof value !== 'object') return { schemaVersion: 1, draft: null }
  const record = value as unknown as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.replace(/[^a-z0-9-]/gi, '') : ''
  const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : ''
  if (!id || !isOutlookEmail(email)) return { schemaVersion: 1, draft: null }
  const domain = sanitizeDomain(record.domain, email.endsWith('@hotmail.com') ? '@hotmail.com' : '@outlook.com')
  return {
    schemaVersion: 1,
    draft: {
      id,
      email,
      domain,
      passwordSealed: sanitizeString(record.passwordSealed),
      profile: sanitizeProfile(record.profile),
      recoveryEmail: sanitizeString(record.recoveryEmail).trim().slice(0, 254),
      createdAt: sanitizeString(record.createdAt, new Date().toISOString()),
    },
  }
}

function writeDraftDocument(draft: StoredDraft | null): void {
  writeJsonDocument(draftPath(), { schemaVersion: 1, draft } satisfies DraftDocument)
}

function readSettingsDocument(): SettingsDocument {
  const raw = readJsonDocument<Partial<SettingsDocument>>(settingsPath(), () => ({
    schemaVersion: 1,
    settings: defaultSettings(),
  }))
  const record = (typeof raw.settings === 'object' && raw.settings !== null ? raw.settings : {}) as Record<string, unknown>
  return {
    schemaVersion: 1,
    settings: {
      domain: sanitizeDomain(record.domain, '@outlook.com'),
      proxy: typeof record.proxy === 'string' ? record.proxy.trim().slice(0, 500) : '',
      password: normalizeOutlookPasswordOptions(record.password),
    },
  }
}

function writeSettingsDocument(settings: OutlookRegisterSettings): void {
  writeJsonDocument(settingsPath(), { schemaVersion: 1, settings } satisfies SettingsDocument)
}

function toPublicAccount(record: StoredAccount): OutlookAccount {
  return {
    id: record.id,
    email: record.email,
    domain: record.domain,
    profile: record.profile,
    recoveryEmail: record.recoveryEmail,
    note: record.note,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastMailboxOpenedAt: record.lastMailboxOpenedAt,
    partition: outlookPartition(record.id),
  }
}

function toPublicDraft(record: StoredDraft): OutlookDraft {
  const opened = openSecretDetailed(record.passwordSealed, 'outlook-register-draft')
  return {
    id: record.id,
    email: record.email,
    password: opened.value,
    passwordReadable: !opened.failed,
    domain: record.domain,
    profile: record.profile,
    recoveryEmail: record.recoveryEmail,
    createdAt: record.createdAt,
  }
}

export function listAccounts(): OutlookAccount[] {
  return readAccountsDocument().accounts.map(toPublicAccount).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export function getAccount(id: string): OutlookAccount | null {
  const record = readAccountsDocument().accounts.find(item => item.id === id)
  return record ? toPublicAccount(record) : null
}

export function getStoredDraft(): StoredDraft | null {
  return readDraftDocument().draft
}

export function getDraft(): OutlookDraft | null {
  const draft = getStoredDraft()
  return draft ? toPublicDraft(draft) : null
}

export function createDraft(force: boolean): { draft: OutlookDraft, replacedId: string | null } {
  const existing = getStoredDraft()
  if (existing && !force) return { draft: toPublicDraft(existing), replacedId: null }

  const settings = getSettings()
  const identity = generateOutlookIdentity(settings.domain, listAccounts().map(item => item.email), settings.password)
  const record: StoredDraft = {
    id: randomUUID(),
    email: identity.email,
    domain: identity.domain,
    passwordSealed: sealSecret(identity.password, 'outlook-register-draft'),
    profile: identity.profile,
    recoveryEmail: '',
    createdAt: new Date().toISOString(),
  }
  writeDraftDocument(record)
  return { draft: toPublicDraft(record), replacedId: existing?.id ?? null }
}

export interface OutlookDraftPatch {
  domain?: OutlookDomain
  profile?: OutlookProfile
  recoveryEmail?: string
  /** 仅接受通过复杂度校验的新密码；空字符串表示不修改 */
  password?: string
}

export function updateDraft(patch: OutlookDraftPatch): OutlookDraft | null {
  const current = getStoredDraft()
  if (!current) return null
  const domain = patch.domain ?? current.domain
  let passwordSealed = current.passwordSealed
  if (patch.password !== undefined) {
    const error = validateOutlookPassword(patch.password)
    if (error) throw new Error(error)
    passwordSealed = sealSecret(patch.password, 'outlook-register-draft')
  }
  const next: StoredDraft = {
    ...current,
    domain,
    email: withOutlookDomain(current.email, domain),
    passwordSealed,
    profile: patch.profile ? sanitizeProfile(patch.profile) : current.profile,
    recoveryEmail: patch.recoveryEmail !== undefined
      ? patch.recoveryEmail.trim().slice(0, 254)
      : current.recoveryEmail,
  }
  writeDraftDocument(next)
  return toPublicDraft(next)
}

export function discardDraft(): string | null {
  const current = getStoredDraft()
  if (!current) return null
  writeDraftDocument(null)
  return current.id
}

export function saveDraftAsAccount(): OutlookAccount | null {
  const draft = getStoredDraft()
  if (!draft) return null
  const now = new Date().toISOString()
  const record: StoredAccount = {
    id: draft.id,
    email: draft.email,
    domain: draft.domain,
    passwordSealed: draft.passwordSealed,
    profile: draft.profile,
    recoveryEmail: draft.recoveryEmail,
    note: '',
    status: 'registered',
    createdAt: draft.createdAt,
    updatedAt: now,
    lastMailboxOpenedAt: null,
  }
  const document = readAccountsDocument()
  document.accounts = [record, ...document.accounts.filter(item => item.id !== record.id)]
  writeAccountsDocument(document)
  writeDraftDocument(null)
  return toPublicAccount(record)
}

export interface OutlookAccountInput {
  email: string
  password: string
  profile?: OutlookProfile
  recoveryEmail?: string
  note?: string
  status?: OutlookAccountStatus
}

export function addAccount(input: OutlookAccountInput): OutlookAccount {
  const email = input.email.trim().toLowerCase()
  if (!isOutlookEmail(email)) throw new Error('邮箱必须是 @outlook.com 或 @hotmail.com 地址')
  const domain = email.endsWith('@hotmail.com') ? '@hotmail.com' : '@outlook.com'
  const now = new Date().toISOString()
  const record: StoredAccount = {
    id: randomUUID(),
    email,
    domain,
    passwordSealed: sealSecret(input.password, 'outlook-register-account'),
    profile: sanitizeProfile(input.profile ?? {
      firstName: 'Manual',
      lastName: 'Account',
      birthYear: 1990,
      birthMonth: 1,
      birthDay: 1,
    }),
    recoveryEmail: (input.recoveryEmail ?? '').trim().slice(0, 254),
    note: (input.note ?? '').slice(0, 2000),
    status: sanitizeStatus(input.status),
    createdAt: now,
    updatedAt: now,
    lastMailboxOpenedAt: null,
  }
  const document = readAccountsDocument()
  document.accounts = [record, ...document.accounts.filter(item => item.email !== record.email)]
  writeAccountsDocument(document)
  logger.info('Outlook account added manually', { id: record.id })
  return toPublicAccount(record)
}

export interface OutlookAccountPatch {
  email?: string
  password?: string
  recoveryEmail?: string
  note?: string
  status?: OutlookAccountStatus
  markMailboxOpened?: boolean
}

export function updateAccount(id: string, patch: OutlookAccountPatch): OutlookAccount | null {
  const document = readAccountsDocument()
  const record = document.accounts.find(item => item.id === id)
  if (!record) return null
  if (patch.email !== undefined) {
    const email = patch.email.trim().toLowerCase()
    if (!isOutlookEmail(email)) throw new Error('邮箱必须是 @outlook.com 或 @hotmail.com 地址')
    if (document.accounts.some(item => item.id !== id && item.email === email)) {
      throw new Error('账号库里已有这个邮箱')
    }
    record.email = email
    record.domain = email.endsWith('@hotmail.com') ? '@hotmail.com' : '@outlook.com'
  }
  if (patch.password !== undefined) {
    const error = validateOutlookPassword(patch.password)
    if (error) throw new Error(error)
    record.passwordSealed = sealSecret(patch.password, 'outlook-register-account')
  }
  if (patch.recoveryEmail !== undefined) record.recoveryEmail = patch.recoveryEmail.trim().slice(0, 254)
  if (patch.note !== undefined) record.note = patch.note.slice(0, 2000)
  if (patch.status !== undefined) record.status = sanitizeStatus(patch.status)
  if (patch.markMailboxOpened) record.lastMailboxOpenedAt = new Date().toISOString()
  record.updatedAt = new Date().toISOString()
  writeAccountsDocument(document)
  return toPublicAccount(record)
}

export function deleteAccount(id: string): OutlookAccount | null {
  const document = readAccountsDocument()
  const record = document.accounts.find(item => item.id === id)
  if (!record) return null
  document.accounts = document.accounts.filter(item => item.id !== id)
  writeAccountsDocument(document)
  return toPublicAccount(record)
}

export function revealAccountPassword(id: string): { password: string, failed: boolean } | null {
  const record = readAccountsDocument().accounts.find(item => item.id === id)
  if (!record) return null
  const opened = openSecretDetailed(record.passwordSealed, 'outlook-register-account')
  return { password: opened.value, failed: opened.failed }
}

export function getSettings(): OutlookRegisterSettings {
  return readSettingsDocument().settings
}

export function updateSettings(patch: Partial<OutlookRegisterSettings>): OutlookRegisterSettings {
  const current = getSettings()
  const next: OutlookRegisterSettings = {
    domain: sanitizeDomain(patch.domain, current.domain),
    proxy: patch.proxy !== undefined ? patch.proxy.trim().slice(0, 500) : current.proxy,
    password: patch.password !== undefined
      ? normalizeOutlookPasswordOptions(patch.password)
      : current.password,
  }
  writeSettingsDocument(next)
  return next
}

export function listAccountPartitions(): string[] {
  const partitions = new Set(listAccounts().map(item => item.partition))
  const draft = getStoredDraft()
  if (draft) partitions.add(outlookPartition(draft.id))
  return [...partitions]
}

export function isOutlookDomainValue(value: unknown): value is OutlookDomain {
  return (OUTLOOK_DOMAINS as readonly string[]).includes(String(value))
}
