import type {
  OutlookAccountStatus,
  OutlookProfile,
  OutlookRegisterSettings,
  OutlookRegisterState,
} from '../../../../shared/outlook-register.ts'
import type { OutlookAccountPatch, OutlookDraftPatch } from '../store/outlook-store.ts'
import { ipcMain } from 'electron'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { isSecretStorageAvailable } from '../../../../backend/utils/secret-box.ts'
import {
  isOutlookDomain,
  isOutlookEmail,
  normalizeOutlookPasswordOptions,
  OUTLOOK_MAILBOX_URL,
  outlookPartition,
} from '../../../../shared/outlook-register.ts'
import {
  applyOutlookSettingsToAllSessions,
  normalizeOutlookProxy,
  prepareOutlookSession,
  resetOutlookSession,
} from '../services/outlook-session.ts'
import {
  addAccount,
  createDraft,
  deleteAccount,
  discardDraft,
  getAccount,
  getDraft,
  getSettings,
  getStoredDraft,
  listAccounts,
  revealAccountPassword,
  saveDraftAsAccount,
  updateAccount,
  updateDraft,
  updateSettings,
} from '../store/outlook-store.ts'
import { OUTLOOK_REGISTER_IPC_CHANNELS } from './channels.ts'

let handlersRegistered = false

function buildState(): OutlookRegisterState {
  return {
    accounts: listAccounts(),
    draft: getDraft(),
    settings: getSettings(),
    secretsAvailable: isSecretStorageAvailable(),
  }
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}参数非法`)
  return value as Record<string, unknown>
}

function readId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9-]{6,64}$/i.test(value.trim())) {
    throw new Error('账号 id 非法')
  }
  return value.trim()
}

function readOptionalId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return readId(value)
}

function readProfile(value: unknown): OutlookProfile {
  const record = readRecord(value, '个人资料')
  const firstName = typeof record.firstName === 'string' ? record.firstName.trim() : ''
  const lastName = typeof record.lastName === 'string' ? record.lastName.trim() : ''
  const birthYear = Number(record.birthYear)
  const birthMonth = Number(record.birthMonth)
  const birthDay = Number(record.birthDay)
  if (!firstName || firstName.length > 50) throw new Error('名字长度需在 1–50 个字符之间')
  if (!lastName || lastName.length > 50) throw new Error('姓氏长度需在 1–50 个字符之间')
  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > 2012) throw new Error('出生年份需在 1900–2012 之间')
  if (!Number.isInteger(birthMonth) || birthMonth < 1 || birthMonth > 12) throw new Error('出生月份需在 1–12 之间')
  if (!Number.isInteger(birthDay) || birthDay < 1 || birthDay > 28) throw new Error('出生日期需在 1–28 之间')
  return { firstName, lastName, birthYear, birthMonth, birthDay }
}

function readRecoveryEmail(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error('辅助邮箱必须是字符串')
  const email = value.trim()
  if (!email) return ''
  if (email.length > 254 || !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(email)) {
    throw new Error('辅助邮箱格式不正确')
  }
  return email
}

function readAccountStatus(value: unknown): OutlookAccountStatus | undefined {
  if (value === undefined) return undefined
  if (value === 'pending' || value === 'registered') return value
  throw new Error('账号状态非法')
}

function readSettingsPatch(value: unknown): Partial<OutlookRegisterSettings> {
  const record = readRecord(value, '设置')
  const patch: Partial<OutlookRegisterSettings> = {}
  if (record.domain !== undefined) {
    if (!isOutlookDomain(record.domain)) throw new Error('邮箱后缀非法')
    patch.domain = record.domain
  }
  if (record.proxy !== undefined) patch.proxy = normalizeOutlookProxy(record.proxy)
  if (record.password !== undefined) {
    patch.password = normalizeOutlookPasswordOptions(record.password)
  }
  return patch
}

async function safeReset(partition: string): Promise<void> {
  try {
    await resetOutlookSession(partition)
  } catch (error) {
    logger.warn('Failed to clear Outlook registration session', {
      partition,
      error: (error as Error).message,
    })
  }
}

export function registerOutlookRegisterHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  safeHandle(ipcMain, OUTLOOK_REGISTER_IPC_CHANNELS.GET_STATE, () => buildState())

  safeHandle(ipcMain, OUTLOOK_REGISTER_IPC_CHANNELS.CREATE_DRAFT, async (_event, value: unknown) => {
    const record = value === undefined ? {} : readRecord(value, '创建草稿')
    const force = record.force === true
    const { replacedId } = createDraft(force)
    if (replacedId) await safeReset(outlookPartition(replacedId))
    return buildState()
  })

  safeHandle(ipcMain, OUTLOOK_REGISTER_IPC_CHANNELS.UPDATE_DRAFT, (_event, value: unknown) => {
    const record = readRecord(value, '更新草稿')
    const patch: OutlookDraftPatch = {}
    if (record.domain !== undefined) {
      if (!isOutlookDomain(record.domain)) throw new Error('邮箱后缀非法')
      patch.domain = record.domain
    }
    if (record.profile !== undefined) patch.profile = readProfile(record.profile)
    if (record.recoveryEmail !== undefined) patch.recoveryEmail = readRecoveryEmail(record.recoveryEmail)
    if (record.password !== undefined) {
      if (typeof record.password !== 'string') throw new Error('密码必须是字符串')
      patch.password = record.password
    }
    updateDraft(patch)
    return buildState()
  })

  safeHandle(ipcMain, OUTLOOK_REGISTER_IPC_CHANNELS.DISCARD_DRAFT, async (_event, value: unknown) => {
    const record = value === undefined ? {} : readRecord(value, '丢弃草稿')
    const requestedId = readOptionalId(record.id)
    const current = getStoredDraft()
    if (!current || (requestedId && requestedId !== current.id)) return buildState()
    discardDraft()
    await safeReset(outlookPartition(current.id))
    return buildState()
  })

  safeHandle(ipcMain, OUTLOOK_REGISTER_IPC_CHANNELS.SAVE_ACCOUNT, async () => {
    const account = saveDraftAsAccount()
    if (!account) throw new Error('没有可保存的注册草稿')
    await prepareOutlookSession(account.partition)
    return buildState()
  })

  safeHandle(ipcMain, OUTLOOK_REGISTER_IPC_CHANNELS.ADD_ACCOUNT, async (_event, value: unknown) => {
    const record = readRecord(value, '添加账号')
    const email = typeof record.email === 'string' ? record.email.trim() : ''
    if (!isOutlookEmail(email)) throw new Error('邮箱必须是 @outlook.com 或 @hotmail.com 地址')
    const password = typeof record.password === 'string' ? record.password : ''
    if (password.length > 128) throw new Error('密码过长')
    const account = addAccount({
      email,
      password,
      profile: record.profile === undefined ? undefined : readProfile(record.profile),
      recoveryEmail: readRecoveryEmail(record.recoveryEmail),
      note: typeof record.note === 'string' ? record.note.slice(0, 2000) : '',
      status: readAccountStatus(record.status) ?? 'registered',
    })
    await prepareOutlookSession(account.partition)
    return buildState()
  })

  safeHandle(ipcMain, OUTLOOK_REGISTER_IPC_CHANNELS.UPDATE_ACCOUNT, (_event, value: unknown) => {
    const record = readRecord(value, '更新账号')
    const id = readId(record.id)
    const patchRecord = readRecord(record.patch, '账号修改')
    const patch: OutlookAccountPatch = {}
    if (patchRecord.email !== undefined) {
      if (typeof patchRecord.email !== 'string') throw new Error('邮箱必须是字符串')
      patch.email = patchRecord.email
    }
    if (patchRecord.password !== undefined) {
      if (typeof patchRecord.password !== 'string') throw new Error('密码必须是字符串')
      if (patchRecord.password.length > 128) throw new Error('密码过长')
      patch.password = patchRecord.password
    }
    if (patchRecord.recoveryEmail !== undefined) patch.recoveryEmail = readRecoveryEmail(patchRecord.recoveryEmail)
    if (patchRecord.note !== undefined) {
      if (typeof patchRecord.note !== 'string') throw new Error('备注必须是字符串')
      patch.note = patchRecord.note.slice(0, 2000)
    }
    if (patchRecord.status !== undefined) patch.status = readAccountStatus(patchRecord.status)
    if (patchRecord.markMailboxOpened === true) patch.markMailboxOpened = true
    const account = updateAccount(id, patch)
    if (!account) throw new Error('账号不存在')
    return buildState()
  })

  safeHandle(ipcMain, OUTLOOK_REGISTER_IPC_CHANNELS.DELETE_ACCOUNT, async (_event, value: unknown) => {
    const record = readRecord(value, '删除账号')
    const id = readId(record.id)
    const account = deleteAccount(id)
    if (!account) throw new Error('账号不存在')
    await safeReset(account.partition)
    return buildState()
  })

  safeHandle(ipcMain, OUTLOOK_REGISTER_IPC_CHANNELS.RESET_SESSION, async (_event, value: unknown) => {
    const record = readRecord(value, '清除登录会话')
    const id = readId(record.id)
    const account = getAccount(id)
    if (!account) throw new Error('账号不存在')
    await resetOutlookSession(account.partition)
    return buildState()
  })

  safeHandle(ipcMain, OUTLOOK_REGISTER_IPC_CHANNELS.REVEAL_PASSWORD, (_event, value: unknown) => {
    const record = readRecord(value, '读取密码')
    const id = readId(record.id)
    const result = revealAccountPassword(id)
    if (!result) throw new Error('账号不存在')
    return result
  })

  safeHandle(ipcMain, OUTLOOK_REGISTER_IPC_CHANNELS.UPDATE_SETTINGS, async (_event, value: unknown) => {
    const previous = getSettings()
    const patch = readSettingsPatch(value)
    updateSettings(patch)
    // 只有代理发生变化才需要重建连接；改密码规则不应打断已打开的页面
    if (patch.proxy !== undefined && patch.proxy !== previous.proxy) {
      await applyOutlookSettingsToAllSessions()
    }
    return buildState()
  })

  safeHandle(ipcMain, OUTLOOK_REGISTER_IPC_CHANNELS.PREPARE_MAILBOX, async (_event, value: unknown) => {
    const record = readRecord(value, '打开邮箱')
    const id = readId(record.id)
    const account = getAccount(id)
    if (!account) throw new Error('账号不存在')
    await prepareOutlookSession(account.partition)
    updateAccount(id, { markMailboxOpened: true })
    return {
      session: { partition: account.partition, url: OUTLOOK_MAILBOX_URL },
      state: buildState(),
    }
  })
}
