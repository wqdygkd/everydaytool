import type { CdpOpenDevToolsPayload, CdpProfile, CdpScript } from '../../../../shared/types.js'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
import { listPageTargets } from '../services/cdp-client.js'
import { openDevToolsFromPayload } from '../services/devtools-service.js'
import { injectorService, setCdpStatusEmitter } from '../services/injector-service.js'
import { cdpConfigStore } from '../store/config-store.js'
import { resolveExecutablePath } from '../utils/resolve-executable.js'
import { CDP_IPC_CHANNELS } from './channels.js'

const require = createRequire(import.meta.url)
const { ipcMain, BrowserWindow, dialog } = require('electron') as typeof import('electron')

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

let handlersRegistered = false

export function registerCdpInjectorHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true
  setCdpStatusEmitter((payload) => {
    broadcast(CDP_IPC_CHANNELS.EVENT_STATUS_CHANGED, payload)
  })

  ipcMain.handle(CDP_IPC_CHANNELS.PROFILE_GET_ALL, async () => {
    const config = await cdpConfigStore.getAll()
    return { profiles: config.profiles, scripts: config.scripts, defaults: config.defaults }
  })

  ipcMain.handle(CDP_IPC_CHANNELS.PROFILE_SAVE, async (_event, profile: CdpProfile) => {
    return cdpConfigStore.saveProfile(profile)
  })

  ipcMain.handle(CDP_IPC_CHANNELS.PROFILE_DELETE, async (_event, id: string) => {
    await injectorService.stopProfile(id)
    return cdpConfigStore.deleteProfile(id)
  })

  ipcMain.handle(CDP_IPC_CHANNELS.SCRIPT_GET_ALL, async () => cdpConfigStore.getScripts())

  ipcMain.handle(CDP_IPC_CHANNELS.SCRIPT_SAVE, async (_event, script: CdpScript) => {
    return cdpConfigStore.saveScript(script)
  })

  ipcMain.handle(CDP_IPC_CHANNELS.SCRIPT_DELETE, async (_event, id: string) => {
    return cdpConfigStore.deleteScript(id)
  })

  ipcMain.handle(CDP_IPC_CHANNELS.SELECT_EXECUTABLE, async () => {
    const isDarwin = process.platform === 'darwin'
    const result = await dialog.showOpenDialog({
      title: isDarwin ? '选择应用或可执行文件' : '选择可执行文件',
      properties: ['openFile'],
      filters: isDarwin
        ? [
            { name: 'macOS 应用', extensions: ['app'] },
            { name: '所有文件', extensions: ['*'] },
          ]
        : undefined,
    })
    if (result.canceled || !result.filePaths[0]) return null
    return resolveExecutablePath(result.filePaths[0])
  })

  ipcMain.handle(CDP_IPC_CHANNELS.SELECT_SCRIPT_FILE, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择脚本文件',
      properties: ['openFile'],
      filters: [{ name: 'JavaScript', extensions: ['js', 'mjs', 'cjs', 'txt'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const filePath = result.filePaths[0]
    const content = await readFile(filePath, 'utf-8')
    return { filePath, content }
  })

  ipcMain.handle(CDP_IPC_CHANNELS.LAUNCH, async (_event, profileId: string) => {
    return injectorService.launchProfile(profileId)
  })

  ipcMain.handle(CDP_IPC_CHANNELS.LAUNCH_BATCH, async (_event, profileIds: string[]) => {
    return injectorService.launchBatch(profileIds)
  })

  ipcMain.handle(CDP_IPC_CHANNELS.STOP, async (_event, profileId: string) => {
    return injectorService.stopProfile(profileId)
  })

  ipcMain.handle(CDP_IPC_CHANNELS.STOP_ALL, async () => injectorService.stopAll())

  ipcMain.handle(CDP_IPC_CHANNELS.GET_RUNNING, async () => injectorService.getRunning())

  ipcMain.handle(CDP_IPC_CHANNELS.REINJECT, async (_event, profileId: string) => {
    return injectorService.reinjectProfile(profileId)
  })

  ipcMain.handle(CDP_IPC_CHANNELS.GET_TARGETS, async (_event, port: number) => {
    return listPageTargets(port)
  })

  ipcMain.handle(CDP_IPC_CHANNELS.OPEN_DEVTOOLS, async (_event, payload: string | CdpOpenDevToolsPayload) => {
    return openDevToolsFromPayload(payload)
  })
}
