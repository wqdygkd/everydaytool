// 平台级（应用壳）IPC 处理器：数据根目录的查看 / 更改 / 打开、磁盘用量、缓存清理。
// 由 electron/main.ts 注册；数据目录变更后的各工具域内重载通过
// options.notifyDataDirectoryChanged 注入（避免 backend 反向依赖 electron/tool-registry）。
import type {
  AppDataDirectoryInfo,
  AppDataDirectoryUpdateResult,
  CacheCleanResult,
  DataRootUsage,
} from '../../shared/types.js'
import { createRequire } from 'node:module'
import path from 'node:path'
import { clearDataRootCaches, scanDataRoot } from '../utils/data-root-scan.js'
import {
  applyDataDirectoryChange,
  getDataDirectory,
  getDefaultDataDirectory,
  markDataDirectoryConfigured,
} from '../utils/data-root.js'
import { logger } from '../utils/logger.js'
import { EDT_APP_IPC_CHANNELS } from './channels.js'

const require = createRequire(import.meta.url)
const { dialog, ipcMain, session, shell } = require('electron') as typeof import('electron')

export interface AppIpcOptions {
  notifyDataDirectoryChanged: () => Promise<void>
}

function getDataDirectoryInfo(): AppDataDirectoryInfo {
  const dataDirectory = getDataDirectory()
  const defaultDataDirectory = getDefaultDataDirectory()
  return {
    dataDirectory,
    defaultDataDirectory,
    isCustom: path.resolve(dataDirectory) !== path.resolve(defaultDataDirectory),
  }
}

export function registerAppIpcHandlers(options: AppIpcOptions): void {
  ipcMain.handle(EDT_APP_IPC_CHANNELS.DATA_DIRECTORY_GET, () => getDataDirectoryInfo())

  ipcMain.handle(EDT_APP_IPC_CHANNELS.DATA_DIRECTORY_SELECT, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择数据目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(EDT_APP_IPC_CHANNELS.DATA_DIRECTORY_UPDATE, async (_event, nextDirectory: string): Promise<AppDataDirectoryUpdateResult> => {
    const result = await applyDataDirectoryChange(nextDirectory)
    if (result.changed) {
      await options.notifyDataDirectoryChanged()
      await markDataDirectoryConfigured()
      logger.info('Data directory changed', { dataDirectory: result.dataDirectory })
    }
    return { ...getDataDirectoryInfo(), changed: result.changed }
  })

  ipcMain.handle(EDT_APP_IPC_CHANNELS.DATA_DIRECTORY_OPEN, async () => {
    const dataDirectory = getDataDirectory()
    const errorMessage = await shell.openPath(dataDirectory)
    if (errorMessage) {
      logger.warn('Failed to open data directory', { dataDirectory, error: errorMessage })
      throw new Error(errorMessage)
    }
    return true
  })

  ipcMain.handle(EDT_APP_IPC_CHANNELS.DATA_USAGE_GET, async (): Promise<DataRootUsage> => {
    const { cacheDirs: _cacheDirs, ...usage } = await scanDataRoot()
    return usage
  })

  ipcMain.handle(EDT_APP_IPC_CHANNELS.CACHE_CLEAR, async (): Promise<CacheCleanResult> => {
    const result = await clearDataRootCaches()
    // 应用自身（渲染层）的 HTTP 缓存一并清掉；体积不并入统计
    try {
      await session.defaultSession.clearCache()
    } catch (error) {
      logger.warn('Failed to clear session cache', { error: (error as Error).message })
    }
    return result
  })
}
