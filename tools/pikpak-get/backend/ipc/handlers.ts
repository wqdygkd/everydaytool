import type {
  PikpakGetConnectionInput,
  PikpakGetExport,
  PikpakGetTaskInput,
} from '../../../../shared/pikpak-get.ts'
import { ipcMain } from 'electron'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { getEngineFacade } from '../engine/adapter.ts'
import { getConnectionView, setConnection } from '../store/connection.ts'
import { PIKPAK_GET_IPC_CHANNELS } from './channels.ts'

let handlersRegistered = false

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}非法`)
  return value.trim()
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('ID 非法')
  return value.trim()
}

export function registerPikpakGetHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  const CH = PIKPAK_GET_IPC_CHANNELS

  // ---- 引擎连接 ----
  safeHandle(ipcMain, CH.CONNECTION_GET, async () => getConnectionView())
  safeHandle(ipcMain, CH.CONNECTION_SET, async (_event, input: PikpakGetConnectionInput) => {
    return setConnection(input)
  })
  safeHandle(ipcMain, CH.CONNECTION_TEST, async () => getEngineFacade().check())

  // ---- 账号池 ----
  safeHandle(ipcMain, CH.ACCOUNTS_LIST, async () => getEngineFacade().listAccounts())
  safeHandle(ipcMain, CH.ACCOUNTS_LOGIN, async (_event, label: unknown, password: unknown) => {
    return getEngineFacade().login(requireString(label, '账号'), requireString(password, '密码'))
  })
  safeHandle(ipcMain, CH.ACCOUNTS_REFRESH, async (_event, accountId: unknown) => {
    return getEngineFacade().refreshAccount(requireId(accountId))
  })
  safeHandle(ipcMain, CH.ACCOUNTS_REVEAL_PASSWORD, async (_event, accountId: unknown) => {
    return getEngineFacade().revealPassword(requireId(accountId))
  })
  safeHandle(ipcMain, CH.ACCOUNTS_WHOAMI, async (_event, accountId: unknown) => {
    return getEngineFacade().whoami(requireId(accountId))
  })
  safeHandle(ipcMain, CH.ACCOUNTS_LOGOUT, async (_event, accountId: unknown) => {
    return getEngineFacade().deleteAccount(requireId(accountId))
  })

  // ---- 分享链接 ----
  safeHandle(ipcMain, CH.LINKS_LIST, async () => getEngineFacade().listLinks())
  safeHandle(ipcMain, CH.LINKS_ADD, async (_event, url: unknown, folder: unknown, passCode: unknown) => {
    return getEngineFacade().addLink(
      requireString(url, '分享链接'),
      typeof folder === 'string' && folder.trim() ? folder.trim() : undefined,
      typeof passCode === 'string' && passCode.trim() ? passCode.trim() : undefined,
    )
  })
  safeHandle(ipcMain, CH.LINKS_UPDATE, async (_event, linkId: unknown, patch: { title?: unknown, folder?: unknown, passCode?: unknown, url?: unknown }) => {
    const next: { title?: string, folder?: string, passCode?: string, url?: string } = {}
    if (typeof patch?.title === 'string') next.title = patch.title.trim().slice(0, 200)
    if (typeof patch?.folder === 'string') next.folder = patch.folder.trim()
    if (typeof patch?.passCode === 'string') next.passCode = patch.passCode.trim()
    if (typeof patch?.url === 'string') next.url = patch.url.trim()
    return getEngineFacade().updateLink(requireId(linkId), next)
  })
  safeHandle(ipcMain, CH.LINKS_DELETE, async (_event, linkId: unknown) => {
    return getEngineFacade().deleteLink(requireId(linkId))
  })
  safeHandle(ipcMain, CH.LINKS_PARSE, async (_event, linkId: unknown, force: unknown) => {
    return getEngineFacade().parseLink(requireId(linkId), force === true)
  })
  safeHandle(ipcMain, CH.LINKS_RESET_RECORDS, async (_event, linkId: unknown, fileIds: unknown) => {
    const ids = Array.isArray(fileIds) ? fileIds.filter(item => typeof item === 'string').map(String) : []
    return getEngineFacade().resetRecords(requireId(linkId), ids)
  })

  // ---- 数据导入导出 ----
  safeHandle(ipcMain, CH.DATA_EXPORT, async () => getEngineFacade().exportData())
  safeHandle(ipcMain, CH.DATA_IMPORT, async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') throw new Error('导入数据非法')
    return getEngineFacade().importData(payload as PikpakGetExport)
  })

  // ---- 下载任务 ----
  safeHandle(ipcMain, CH.TASKS_LIST, async () => getEngineFacade().listTasks())
  safeHandle(ipcMain, CH.TASKS_GET, async (_event, taskId: unknown) => {
    return getEngineFacade().getTask(requireId(taskId))
  })
  safeHandle(ipcMain, CH.TASKS_START, async (_event, input: PikpakGetTaskInput) => {
    if (!input || typeof input.linkId !== 'string' || !input.linkId.trim()) throw new Error('任务参数非法')
    const task: PikpakGetTaskInput = {
      linkId: input.linkId.trim(),
      fileIds: Array.isArray(input.fileIds) ? input.fileIds.filter(item => typeof item === 'string') : input.fileIds ?? null,
      dest: typeof input.dest === 'string' && input.dest.trim() ? input.dest.trim() : null,
      accountId: typeof input.accountId === 'string' && input.accountId.trim() ? input.accountId.trim() : null,
    }
    return getEngineFacade().startTask(task)
  })
  safeHandle(ipcMain, CH.TASKS_CANCEL, async (_event, taskId: unknown) => {
    return getEngineFacade().cancelTask(requireId(taskId))
  })
}
