import type { WxpSettings } from '../../../../shared/wxp.ts'
import { broadcastToWindows } from '../../../../server/utils/broadcast.ts'
import { registerCommand } from '../../../../server/utils/commands.ts'
import { fileDialog } from '../../../../server/utils/platform.ts'
import { setWxpDataCacheEmitter } from '../services/auto-collect-service.ts'
import { collectWxpData } from '../services/data-collector.ts'
import { assertSettings, setWxpStatusEmitter, wxpService } from '../services/wxp-service.ts'
import { wxpConfigStore } from '../store/config-store.ts'
import { dataCacheStore } from '../store/data-cache-store.ts'
import { detectWxpExecutable } from '../utils/detect-executable.ts'
import { resolveExecutablePath } from '../utils/resolve-executable.ts'
import { WXP_COMMANDS } from './channels.ts'

function broadcast(channel: string, payload: unknown): void {
  broadcastToWindows(channel, payload)
}

let handlersRegistered = false

export function registerWxpCommands(): void {
  if (handlersRegistered) return
  handlersRegistered = true
  setWxpStatusEmitter(state => broadcast(WXP_COMMANDS.EVENT_STATUS_CHANGED, state))
  setWxpDataCacheEmitter(cache => broadcast(WXP_COMMANDS.EVENT_DATA_CACHE_UPDATED, cache))

  registerCommand('wxpEnhancer', WXP_COMMANDS.GET_ALL, async () => {
    const config = await wxpConfigStore.getAll()
    return { ...config, running: wxpService.getRunning() }
  })

  // executablePath 最终会进入 spawn：保存前先校验非空格式与端口范围，避免被写成任意可执行程序
  registerCommand('wxpEnhancer', WXP_COMMANDS.SAVE_SETTINGS, async (patch: Partial<WxpSettings>) => {
    const merged = { ...(await wxpConfigStore.getSettings()), ...patch }
    assertSettings(merged)
    const settings = await wxpConfigStore.saveSettings(patch)
    // 角标开关等影响注入脚本的设置，保存后在运行中的 WXP 上立即生效
    await wxpService.applyIfRunning().catch(() => false)
    return settings
  })

  registerCommand('wxpEnhancer', WXP_COMMANDS.SELECT_EXECUTABLE, async () => {
    const result = await fileDialog.open({
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

  registerCommand('wxpEnhancer', WXP_COMMANDS.DETECT_EXECUTABLE, async () => detectWxpExecutable())

  registerCommand('wxpEnhancer', WXP_COMMANDS.LAUNCH, async () => wxpService.launch())

  registerCommand('wxpEnhancer', WXP_COMMANDS.STOP, async () => wxpService.stop())

  registerCommand('wxpEnhancer', WXP_COMMANDS.REINJECT, async () => wxpService.reinject())

  registerCommand('wxpEnhancer', WXP_COMMANDS.CLEAR_LOGIN_CACHE, async () => wxpService.clearLoginCache())

  registerCommand('wxpEnhancer', WXP_COMMANDS.GET_DATA_CACHE, async () => dataCacheStore.get())

  registerCommand('wxpEnhancer', WXP_COMMANDS.COLLECT_DATA, async () => {
    const running = wxpService.getRunning()
    if (!running) {
      throw new Error('WXP 未在运行，无法读取数据；请先启动 WXP')
    }
    return collectWxpData(running.port)
  })
}
