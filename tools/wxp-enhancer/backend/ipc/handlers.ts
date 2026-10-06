import type { WxpEnhancement, WxpOpenDevToolsPayload, WxpSettings } from '../../../../shared/types.js'
import { createRequire } from 'node:module'
import { listPageTargets } from '../services/cdp-client.js'
import { openDevToolsFromPayload, registerDevtoolsPauseListener } from '../services/devtools-service.js'
import { setWxpStatusEmitter, wxpService } from '../services/wxp-service.js'
import { wxpConfigStore } from '../store/config-store.js'
import { detectWxpExecutable } from '../utils/detect-executable.js'
import { resolveExecutablePath } from '../utils/resolve-executable.js'
import { WXP_IPC_CHANNELS } from './channels.js'

const require = createRequire(import.meta.url)
const { ipcMain, BrowserWindow, dialog } = require('electron') as typeof import('electron')

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

let handlersRegistered = false

export function registerWxpHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true
  setWxpStatusEmitter(state => broadcast(WXP_IPC_CHANNELS.EVENT_STATUS_CHANGED, state))
  // DevTools 调试期间暂停注入，关闭后恢复（计数归零才通知 resume）
  registerDevtoolsPauseListener((port, action) => {
    if (action === 'pause') {
      wxpService.onDevtoolsPause(port)
    } else {
      wxpService.onDevtoolsResume(port)
    }
  })

  ipcMain.handle(WXP_IPC_CHANNELS.GET_ALL, async () => {
    const config = await wxpConfigStore.getAll()
    return { ...config, running: wxpService.getRunning() }
  })

  ipcMain.handle(WXP_IPC_CHANNELS.SAVE_SETTINGS, async (_event, patch: Partial<WxpSettings>) => {
    const settings = await wxpConfigStore.saveSettings(patch)
    // 角标开关等影响注入脚本的设置，保存后在运行中的 WXP 上立即生效
    await wxpService.applyIfRunning().catch(() => false)
    return settings
  })

  ipcMain.handle(WXP_IPC_CHANNELS.ENHANCEMENT_SAVE, async (_event, enhancement: WxpEnhancement) => {
    const saved = await wxpConfigStore.saveEnhancement(enhancement)
    const applied = await wxpService.applyIfRunning().catch(() => false)
    return { enhancement: saved, applied }
  })

  ipcMain.handle(WXP_IPC_CHANNELS.ENHANCEMENT_DELETE, async (_event, id: string) => {
    const enhancements = await wxpConfigStore.deleteEnhancement(id)
    const applied = await wxpService.applyIfRunning().catch(() => false)
    return { enhancements, applied }
  })

  ipcMain.handle(WXP_IPC_CHANNELS.SELECT_EXECUTABLE, async () => {
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

  ipcMain.handle(WXP_IPC_CHANNELS.DETECT_EXECUTABLE, async () => detectWxpExecutable())

  ipcMain.handle(WXP_IPC_CHANNELS.LAUNCH, async () => wxpService.launch())

  ipcMain.handle(WXP_IPC_CHANNELS.STOP, async () => wxpService.stop())

  ipcMain.handle(WXP_IPC_CHANNELS.REINJECT, async () => wxpService.reinject())

  ipcMain.handle(WXP_IPC_CHANNELS.GET_TARGETS, async (_event, port: number) => {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('无效的调试端口')
    }
    return listPageTargets(port)
  })

  ipcMain.handle(WXP_IPC_CHANNELS.OPEN_DEVTOOLS, async (_event, payload: string | WxpOpenDevToolsPayload) => {
    return openDevToolsFromPayload(payload)
  })
}
