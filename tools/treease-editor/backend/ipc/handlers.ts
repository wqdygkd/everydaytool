import type { TreeaseInterceptRule } from '../../../../shared/treease.ts'
import { ipcMain } from 'electron'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { interceptService } from '../services/intercept-service.ts'
import { treeaseRulesStore } from '../store/rules-store.ts'
import { TREEASE_EDITOR_IPC_CHANNELS } from './channels.ts'

let handlersRegistered = false

export function registerTreeaseHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true
  safeHandle(ipcMain, TREEASE_EDITOR_IPC_CHANNELS.INTERCEPT_START, async (_event, webContentsId: number, rules: TreeaseInterceptRule[]) => {
    if (!Number.isInteger(webContentsId)) throw new Error('页面内核 ID 非法')
    if (!Array.isArray(rules)) throw new Error('拦截规则非法')
    return interceptService.start(webContentsId, rules)
  })

  safeHandle(ipcMain, TREEASE_EDITOR_IPC_CHANNELS.INTERCEPT_STOP, async (_event, webContentsId: number) => {
    return interceptService.stop(webContentsId)
  })

  safeHandle(ipcMain, TREEASE_EDITOR_IPC_CHANNELS.INTERCEPT_UPDATE_RULES, async (_event, webContentsId: number, rules: TreeaseInterceptRule[]) => {
    if (!Array.isArray(rules)) throw new Error('拦截规则非法')
    return interceptService.updateRules(webContentsId, rules)
  })

  safeHandle(ipcMain, TREEASE_EDITOR_IPC_CHANNELS.INTERCEPT_STATUS, async (_event, webContentsId: number | undefined) => {
    if (typeof webContentsId !== 'number') throw new Error('页面内核 ID 非法')
    return interceptService.getStatus(webContentsId)
  })

  safeHandle(ipcMain, TREEASE_EDITOR_IPC_CHANNELS.CACHE_CLEAR, async () => {
    return interceptService.clearCache()
  })

  // 规则 / 开关：配置层文件是唯一事实来源，LocalStorage 只是渲染层镜像
  safeHandle(ipcMain, TREEASE_EDITOR_IPC_CHANNELS.RULES_GET, () => treeaseRulesStore.read())

  safeHandle(ipcMain, TREEASE_EDITOR_IPC_CHANNELS.RULES_SET, (_event, rules: unknown, enabled: unknown) => {
    return treeaseRulesStore.write(rules, enabled)
  })
}
