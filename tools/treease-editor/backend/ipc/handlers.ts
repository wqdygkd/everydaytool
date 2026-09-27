import type { TreeaseInterceptRule } from '../../../../shared/types.js'
import { createRequire } from 'node:module'
import { interceptService } from '../services/intercept-service.js'
import { TREEASE_IPC_CHANNELS } from './channels.js'

const require = createRequire(import.meta.url)
const { ipcMain } = require('electron') as typeof import('electron')

let handlersRegistered = false

export function registerTreeaseHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true
  ipcMain.handle(TREEASE_IPC_CHANNELS.INTERCEPT_START, async (_event, webContentsId: number, rules: TreeaseInterceptRule[]) => {
    if (!Number.isInteger(webContentsId)) throw new Error('页面内核 ID 非法')
    if (!Array.isArray(rules)) throw new Error('拦截规则非法')
    return interceptService.start(webContentsId, rules)
  })

  ipcMain.handle(TREEASE_IPC_CHANNELS.INTERCEPT_STOP, async (_event, webContentsId: number) => {
    return interceptService.stop(webContentsId)
  })

  ipcMain.handle(TREEASE_IPC_CHANNELS.INTERCEPT_UPDATE_RULES, async (_event, webContentsId: number, rules: TreeaseInterceptRule[]) => {
    if (!Array.isArray(rules)) throw new Error('拦截规则非法')
    return interceptService.updateRules(webContentsId, rules)
  })

  ipcMain.handle(TREEASE_IPC_CHANNELS.INTERCEPT_STATUS, async (_event, webContentsId: number | undefined) => {
    if (typeof webContentsId !== 'number') throw new Error('页面内核 ID 非法')
    return interceptService.getStatus(webContentsId)
  })

  ipcMain.handle(TREEASE_IPC_CHANNELS.CACHE_CLEAR, async () => {
    return interceptService.clearCache()
  })
}
