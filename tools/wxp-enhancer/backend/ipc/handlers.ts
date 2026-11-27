import type { WxpChannelTogglePayload, WxpSettings } from '../../../../shared/wxp.ts'
import { resolve } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { setWxpDataCacheEmitter } from '../services/auto-collect-service.ts'
import { readChannelSnapshot, toggleChannel } from '../services/channel-service.ts'
import { collectWxpData } from '../services/data-collector.ts'
import { assertSettings, setWxpStatusEmitter, wxpService } from '../services/wxp-service.ts'
import { wxpConfigStore } from '../store/config-store.ts'
import { dataCacheStore } from '../store/data-cache-store.ts'
import { detectWxpExecutable } from '../utils/detect-executable.ts'
import { resolveExecutablePath } from '../utils/resolve-executable.ts'
import { WXP_ENHANCER_IPC_CHANNELS } from './channels.ts'

function broadcast(channel: string, payload: unknown): void {
  broadcastToWindows(channel, payload)
}

/** 通道类操作只在「已连上 CDP」时才有意义：未就绪时给一句能照做的提示，而不是 CDP 超时 */
function activePort(): number {
  const running = wxpService.getRunning()
  if (!running || running.status !== 'running') {
    throw new Error('WXP 未连接：请先启动并等待连接完成')
  }
  return running.port
}

let handlersRegistered = false
/** 只有文件选择对话框 / 自动检测返回过的路径才允许保存，避免 IPC 直接写入任意可执行文件。 */
const approvedExecutablePaths = new Set<string>()

export function registerWxpHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true
  setWxpStatusEmitter(state => broadcast(WXP_ENHANCER_IPC_CHANNELS.EVENT_STATUS_CHANGED, state))
  setWxpDataCacheEmitter(cache => broadcast(WXP_ENHANCER_IPC_CHANNELS.EVENT_DATA_CACHE_UPDATED, cache))

  safeHandle(ipcMain, WXP_ENHANCER_IPC_CHANNELS.GET_ALL, async () => {
    const config = await wxpConfigStore.getAll()
    return { ...config, running: wxpService.getRunning() }
  })

  // executablePath 最终会进入 spawn：保存前先校验非空格式与端口范围，避免被写成任意可执行程序
  safeHandle(ipcMain, WXP_ENHANCER_IPC_CHANNELS.SAVE_SETTINGS, async (_event, patch: Partial<WxpSettings>) => {
    const current = await wxpConfigStore.getSettings()
    const merged = { ...current, ...patch }
    assertSettings(merged)
    if (merged.executablePath.trim() !== current.executablePath.trim()) {
      const normalized = resolve(merged.executablePath.trim())
      if (!approvedExecutablePaths.has(normalized)) {
        throw new Error('请通过“选择文件”或“自动检测”设置 WXP 路径')
      }
    }
    const settings = await wxpConfigStore.saveSettings(patch)
    // 角标开关等影响注入脚本的设置，保存后在运行中的 WXP 上立即生效
    await wxpService.applyIfRunning().catch(() => false)
    return settings
  })

  safeHandle(ipcMain, WXP_ENHANCER_IPC_CHANNELS.SELECT_EXECUTABLE, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 WXP 可执行文件',
      properties: ['openFile'],
      filters: [
        { name: '可执行文件', extensions: ['exe'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const resolved = await resolveExecutablePath(result.filePaths[0])
    approvedExecutablePaths.add(resolve(resolved))
    return resolved
  })

  safeHandle(ipcMain, WXP_ENHANCER_IPC_CHANNELS.DETECT_EXECUTABLE, async () => {
    const detected = await detectWxpExecutable()
    if (detected) approvedExecutablePaths.add(resolve(detected))
    return detected
  })

  safeHandle(ipcMain, WXP_ENHANCER_IPC_CHANNELS.LAUNCH, async () => wxpService.launch())

  safeHandle(ipcMain, WXP_ENHANCER_IPC_CHANNELS.STOP, async () => wxpService.stop())

  safeHandle(ipcMain, WXP_ENHANCER_IPC_CHANNELS.REINJECT, async () => wxpService.reinject())

  safeHandle(ipcMain, WXP_ENHANCER_IPC_CHANNELS.CLEAR_LOGIN_CACHE, async () => wxpService.clearLoginCache())

  safeHandle(ipcMain, WXP_ENHANCER_IPC_CHANNELS.GET_DATA_CACHE, async () => dataCacheStore.get())

  safeHandle(ipcMain, WXP_ENHANCER_IPC_CHANNELS.COLLECT_DATA, async () => {
    const running = wxpService.getRunning()
    if (!running) {
      throw new Error('WXP 未在运行，无法读取数据；请先启动 WXP')
    }
    return collectWxpData(running.port)
  })

  safeHandle(ipcMain, WXP_ENHANCER_IPC_CHANNELS.GET_CHANNELS, async (_event, hospitalCode?: unknown) => {
    return readChannelSnapshot(activePort(), typeof hospitalCode === 'string' ? hospitalCode : '')
  })

  safeHandle(ipcMain, WXP_ENHANCER_IPC_CHANNELS.OPEN_CHANNEL, async (_event, payload: WxpChannelTogglePayload) => {
    return toggleChannel(activePort(), payload, 'open')
  })

  safeHandle(ipcMain, WXP_ENHANCER_IPC_CHANNELS.CLOSE_CHANNEL, async (_event, payload: WxpChannelTogglePayload) => {
    return toggleChannel(activePort(), payload, 'close')
  })
}
