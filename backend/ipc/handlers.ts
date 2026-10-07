// 平台级（应用壳）IPC 处理器：数据根目录的查看 / 更改 / 打开、磁盘用量、缓存清理。
// 由 electron/main.ts 注册；数据目录变更后的各工具域内重载通过
// options.notifyDataDirectoryChanged 注入（避免 backend 反向依赖 electron/tool-registry）。
import type {
  AppDataDirectoryInfo,
  AppDataDirectoryUpdateResult,
  CacheCleanResult,
  DataRootUsage,
} from '../../shared/types.ts'
import { createRequire } from 'node:module'
import path from 'node:path'
import { isSafeDataDirectory } from '../../shared/path-guard.ts'
import { clearDataRootCaches, invalidateScanCache, scanDataRoot } from '../utils/data-root-scan.ts'
import {
  applyDataDirectoryChange,
  getDataDirectory,
  getDefaultDataDirectory,
  markDataDirectoryConfigured,
} from '../utils/data-root.ts'
import { safeHandle } from '../utils/ipc-safety.ts'
import { logger } from '../utils/logger.ts'
import { EDT_APP_IPC_CHANNELS } from './channels.ts'

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

    const result = await applyDataDirectoryChange(nextDirectory)
    if (result.changed) {
      await options.notifyDataDirectoryChanged()
      await markDataDirectoryConfigured()
      // 目录已切换，缓存的扫描结果不再有效
      invalidateScanCache()
      logger.info('Data directory changed', { changed: true })
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
}
