// 平台级（应用壳）IPC 处理器：数据根目录的查看 / 更改 / 打开、磁盘用量、缓存清理、
// 窗口外观（半透明 / 系统材质）的读取与切换、打开调试控制台。
// 数据目录切换只写 pending，实际迁移与生效在下次启动的 ready 之前完成。
import type {
  AppDataDirectoryInfo,
  AppDataDirectoryUpdateResult,
  CacheCleanResult,
  DataRootUsage,
} from '../../shared/app.ts'
import type { WindowAppearance, WindowAppearanceCapabilities, WindowAppearanceUpdate } from '../../shared/appearance.ts'
import { BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { getWindowAppearance, updateWindowAppearance } from '../utils/appearance-store.ts'
import { clearDataRootCaches, scanDataRoot } from '../utils/data-root-scan.ts'
import {
  getDataDirectory,
  getDefaultDataDirectory,
  getPendingDataDirectory,
  markDataDirectoryConfigured,
  requestDataDirectoryChange,
} from '../utils/data-root.ts'
import { safeHandle } from '../utils/ipc-safety.ts'
import { logger } from '../utils/logger.ts'
import { isSafeDataDirectory, isSamePath } from '../utils/path-guard.ts'
import { EDT_APP_IPC_CHANNELS } from './channels.ts'

export interface AppIpcOptions {
  /** 外观变更后由 main.ts 应用到真实窗口，并回推最新值给渲染层 */
  applyWindowAppearance: (appearance: WindowAppearance) => void
  /** 平台能力由 main.ts 注入（需要读 process.platform / Windows build） */
  getAppearanceCapabilities: () => WindowAppearanceCapabilities
}

function getDataDirectoryInfo(): AppDataDirectoryInfo {
  const dataDirectory = getDataDirectory()
  const defaultDataDirectory = getDefaultDataDirectory()
  return {
    dataDirectory,
    defaultDataDirectory,
    isCustom: !isSamePath(dataDirectory, defaultDataDirectory),
    pendingDataDirectory: getPendingDataDirectory(),
  }
}

export function registerAppIpcHandlers(options: AppIpcOptions): void {
  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.DATA_DIRECTORY_GET, () => getDataDirectoryInfo())

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.DATA_DIRECTORY_SELECT, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择数据目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.DATA_DIRECTORY_UPDATE, async (_event, nextDirectory: string): Promise<AppDataDirectoryUpdateResult> => {
    // 数据目录可被改到任意位置并承载递归删除/写文件，先做边界校验
    const guard = isSafeDataDirectory(nextDirectory)
    if (!guard.ok) {
      throw new Error(guard.reason || '数据目录不合法')
    }

    const result = await requestDataDirectoryChange(nextDirectory)
    if (result.changed) {
      await markDataDirectoryConfigured()
      logger.info('Data directory change pending restart', { target: result.pendingDataDirectory })
    }
    return { ...getDataDirectoryInfo(), changed: result.changed }
  })

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.DATA_DIRECTORY_OPEN, async () => {
    const dataDirectory = getDataDirectory()
    const errorMessage = await shell.openPath(dataDirectory)
    if (errorMessage) {
      logger.warn('Failed to open data directory', { error: errorMessage })
      throw new Error(errorMessage)
    }
    return true
  })

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.DATA_USAGE_GET, async (): Promise<DataRootUsage> => {
    const { cacheDirs: _cacheDirs, ...usage } = await scanDataRoot()
    return usage
  })

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.APPEARANCE_GET, () => ({
    appearance: getWindowAppearance(),
    capabilities: options.getAppearanceCapabilities(),
  }))

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.APPEARANCE_SET, async (_event, patch: WindowAppearanceUpdate): Promise<WindowAppearance> => {
    const next = await updateWindowAppearance(patch, options.getAppearanceCapabilities())
    // 先应用到真实窗口，再回推：渲染层收到的就是最终生效值（含平台降级）
    options.applyWindowAppearance(next)
    return next
  })

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.CACHE_CLEAR, async (): Promise<CacheCleanResult> => {
    const result = await clearDataRootCaches()
    // 应用自身（渲染层）的 HTTP 缓存一并清掉；体积不并入统计
    try {
      await session.defaultSession.clearCache()
    } catch (error) {
      logger.warn('Failed to clear session cache', { error: (error as Error).message })
    }
    return result
  })

  // 设置页的「打开调试控制台」：给调用方窗口开一个独立 DevTools 窗口。
  // undocked 而非 detach：仍可停靠回窗口；独立窗口不会挤压应用自身的内容区。
  // 已打开时 openDevTools 只负责把控制台拉到前台，不会反向关掉它。
  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.DEVTOOLS_OPEN, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('找不到调用方窗口')
    win.webContents.openDevTools({ mode: 'undocked', activate: true })
    return true
  })
}
