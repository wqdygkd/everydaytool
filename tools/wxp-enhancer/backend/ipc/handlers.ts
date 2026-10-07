import type { WxpEnhancement, WxpSettings } from '../../../../shared/types.ts'
import { createRequire } from 'node:module'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { collectWxpData } from '../services/data-collector.ts'
import { assertSettings, setWxpStatusEmitter, wxpService } from '../services/wxp-service.ts'
import { wxpConfigStore } from '../store/config-store.ts'
import { dataCacheStore } from '../store/data-cache-store.ts'
import { detectWxpExecutable } from '../utils/detect-executable.ts'
import { resolveExecutablePath } from '../utils/resolve-executable.ts'
import { WXP_IPC_CHANNELS } from './channels.ts'

const require = createRequire(import.meta.url)
const { ipcMain, dialog } = require('electron') as typeof import('electron')

function broadcast(channel: string, payload: unknown): void {
  broadcastToWindows(channel, payload)
}

let handlersRegistered = false

export function registerWxpHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true
  setWxpStatusEmitter(state => broadcast(WXP_IPC_CHANNELS.EVENT_STATUS_CHANGED, state))

  safeHandle(ipcMain, WXP_IPC_CHANNELS.GET_ALL, async () => {
    const config = await wxpConfigStore.getAll()
    return { ...config, running: wxpService.getRunning() }
  })

  // executablePath 最终会进入 spawn：保存前先校验非空格式与端口范围，避免被写成任意可执行程序
  safeHandle(ipcMain, WXP_IPC_CHANNELS.SAVE_SETTINGS, async (_event, patch: Partial<WxpSettings>) => {
    const merged = { ...(await wxpConfigStore.getSettings()), ...patch }
    assertSettings(merged)
    const settings = await wxpConfigStore.saveSettings(patch)
    // 角标开关等影响注入脚本的设置，保存后在运行中的 WXP 上立即生效
    await wxpService.applyIfRunning().catch(() => false)
    return settings
  })

  safeHandle(ipcMain, WXP_IPC_CHANNELS.ENHANCEMENT_SAVE, async (_event, enhancement: WxpEnhancement) => {
    const saved = await wxpConfigStore.saveEnhancement(enhancement)
    const applied = await wxpService.applyIfRunning().catch(() => false)
    return { enhancement: saved, applied }
  })

  safeHandle(ipcMain, WXP_IPC_CHANNELS.ENHANCEMENT_DELETE, async (_event, id: string) => {
    const enhancements = await wxpConfigStore.deleteEnhancement(id)
    const applied = await wxpService.applyIfRunning().catch(() => false)
    return { enhancements, applied }
  })

  safeHandle(ipcMain, WXP_IPC_CHANNELS.SELECT_EXECUTABLE, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 WXP 可执行文件',
      properties: ['openFile'],
      filters: [
        { name: '可执行文件', extensions: ['exe'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return resolveExecutablePath(result.filePaths[0])
  })

  safeHandle(ipcMain, WXP_IPC_CHANNELS.DETECT_EXECUTABLE, async () => detectWxpExecutable())

  safeHandle(ipcMain, WXP_IPC_CHANNELS.LAUNCH, async () => wxpService.launch())

  safeHandle(ipcMain, WXP_IPC_CHANNELS.STOP, async () => wxpService.stop())

  safeHandle(ipcMain, WXP_IPC_CHANNELS.REINJECT, async () => wxpService.reinject())

  safeHandle(ipcMain, WXP_IPC_CHANNELS.CLEAR_LOGIN_CACHE, async () => wxpService.clearLoginCache())

  safeHandle(ipcMain, WXP_IPC_CHANNELS.GET_DATA_CACHE, async () => dataCacheStore.get())

  safeHandle(ipcMain, WXP_IPC_CHANNELS.COLLECT_DATA, async () => {
    const running = wxpService.getRunning()
    if (!running) {
      throw new Error('WXP 未在运行，无法读取数据；请先启动 WXP')
    }
    return collectWxpData(running.port)
  })
}
