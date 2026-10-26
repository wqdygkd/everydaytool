import { ipcMain, shell } from 'electron'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { cancelActiveDownload, isWb2apiCancelled } from '../services/busy-flag.ts'
import { readConfigJson, resolveConfiguredPort } from '../services/config-service.ts'
import {
  applyUpdate,
  checkUpdate,
  installFromGithub,
  installFromLocalZip,
} from '../services/install-service.ts'
import {
  killOrphanProcesses,
  startManagedProcess,
  stopManagedProcess,
} from '../services/process-service.ts'
import {
  buildState,
  publishStateNow,
  setLastError,
} from '../services/state-service.ts'
import { ensureWb2apiDirs, getWb2apiRootDir } from '../utils/paths.ts'
import { WB2API_PANEL_IPC_CHANNELS } from './channels.ts'

export function registerWb2apiPanelHandlers(): void {
  safeHandle(ipcMain, WB2API_PANEL_IPC_CHANNELS.GET_STATE, async () => buildState())

  safeHandle(ipcMain, WB2API_PANEL_IPC_CHANNELS.INSTALL, async () => {
    setLastError(null)
    try {
      await installFromGithub()
      return await publishStateNow()
    } catch (error) {
      // 用户主动取消不算失败：不写 lastError，否则右栏会多出一条假的「最近错误」
      if (!isWb2apiCancelled(error)) setLastError(error instanceof Error ? error.message : String(error))
      await publishStateNow()
      throw error
    }
  })

  safeHandle(ipcMain, WB2API_PANEL_IPC_CHANNELS.INSTALL_FROM_ZIP, async () => {
    setLastError(null)
    try {
      const manifest = await installFromLocalZip()
      if (!manifest) return await buildState()
      return await publishStateNow()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      await publishStateNow()
      throw error
    }
  })

  safeHandle(ipcMain, WB2API_PANEL_IPC_CHANNELS.CANCEL_DOWNLOAD, async () => {
    const ok = cancelActiveDownload()
    await publishStateNow()
    return { cancelled: ok }
  })

  safeHandle(ipcMain, WB2API_PANEL_IPC_CHANNELS.CHECK_UPDATE, async () => {
    const info = await checkUpdate()
    // 检查结果缓存在主进程：推一次状态，重开页签 / 其它窗口都能直接看到「最新版本」
    await publishStateNow()
    return info
  })

  safeHandle(ipcMain, WB2API_PANEL_IPC_CHANNELS.APPLY_UPDATE, async () => {
    setLastError(null)
    try {
      await applyUpdate()
      return await publishStateNow()
    } catch (error) {
      if (!isWb2apiCancelled(error)) setLastError(error instanceof Error ? error.message : String(error))
      await publishStateNow()
      throw error
    }
  })

  safeHandle(ipcMain, WB2API_PANEL_IPC_CHANNELS.START, async () => {
    setLastError(null)
    try {
      await startManagedProcess()
      return await publishStateNow()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      await publishStateNow()
      throw error
    }
  })

  safeHandle(ipcMain, WB2API_PANEL_IPC_CHANNELS.STOP, async () => {
    try {
      await stopManagedProcess()
      setLastError(null)
      return await publishStateNow()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      await publishStateNow()
      throw error
    }
  })

  safeHandle(ipcMain, WB2API_PANEL_IPC_CHANNELS.RESTART, async () => {
    setLastError(null)
    try {
      await stopManagedProcess()
      await startManagedProcess()
      return await publishStateNow()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      await publishStateNow()
      throw error
    }
  })

  safeHandle(ipcMain, WB2API_PANEL_IPC_CHANNELS.KILL_ORPHAN, async () => {
    const config = await readConfigJson()
    const port = resolveConfiguredPort(config)
    const killed = await killOrphanProcesses(port)
    logger.info('wb2api orphan killed', { port, killed })
    return await publishStateNow()
  })

  safeHandle(ipcMain, WB2API_PANEL_IPC_CHANNELS.OPEN_DATA_DIR, async () => {
    await ensureWb2apiDirs()
    const err = await shell.openPath(getWb2apiRootDir())
    if (err) throw new Error(err)
    return true
  })
}
