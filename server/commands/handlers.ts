// 平台级（应用壳）命令处理器：数据根目录的查看 / 更改 / 打开、磁盘用量、缓存清理、
// 打开调试控制台。窗口外观（半透明 / 系统材质）由 Rust 宿主原生处理（见 src-tauri/src/appearance.rs），
// 因为它必须直接操作窗口；其余处理器由 Node 业务运行时注册。
import type {
  AppDataDirectoryInfo,
  AppDataDirectoryUpdateResult,
  CacheCleanResult,
  DataRootUsage,
} from '../../shared/app.ts'
import path from 'node:path'
import { isSafeDataDirectory } from '../../shared/path-guard.ts'
import { registerCommand } from '../utils/commands.ts'
import { clearDataRootCaches, invalidateScanCache, scanDataRoot } from '../utils/data-root-scan.ts'
import {
  applyDataDirectoryChange,
  getDataDirectory,
  getDefaultDataDirectory,
  markDataDirectoryConfigured,
} from '../utils/data-root.ts'
import { logger } from '../utils/logger.ts'
import { fileDialog, system, webview } from '../utils/platform.ts'
import { APP_COMMANDS } from './channels.ts'

export interface AppCommandOptions {
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

export function registerAppCommands(options: AppCommandOptions): void {
  registerCommand('edtApp', APP_COMMANDS.DATA_DIRECTORY_GET, () => getDataDirectoryInfo())

  registerCommand('edtApp', APP_COMMANDS.DATA_DIRECTORY_SELECT, async () => {
    const result = await fileDialog.open({
      title: '选择数据目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  registerCommand('edtApp', APP_COMMANDS.DATA_DIRECTORY_UPDATE, async (nextDirectory: string): Promise<AppDataDirectoryUpdateResult> => {
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

  registerCommand('edtApp', APP_COMMANDS.DATA_DIRECTORY_OPEN, async () => {
    const dataDirectory = getDataDirectory()
    const errorMessage = await system.openPath(dataDirectory)
    if (errorMessage) {
      logger.warn('Failed to open data directory', { error: errorMessage })
      throw new Error(errorMessage)
    }
    return true
  })

  registerCommand('edtApp', APP_COMMANDS.DATA_USAGE_GET, async (): Promise<DataRootUsage> => {
    const { cacheDirs: _cacheDirs, ...usage } = await scanDataRoot()
    return usage
  })

  registerCommand('edtApp', APP_COMMANDS.CACHE_CLEAR, async (): Promise<CacheCleanResult> => {
    const result = await clearDataRootCaches()
    // 应用自身（渲染层）的 HTTP 缓存一并清掉；体积不并入统计
    try {
      await webview.clearCache()
    } catch (error) {
      logger.warn('Failed to clear session cache', { error: (error as Error).message })
    }
    return result
  })

  // 设置页的「打开调试控制台」：为调用方窗口打开独立 DevTools 窗口。
  // 已打开时 openDevTools 只负责把控制台拉到前台，不会反向关掉它。
  registerCommand('edtApp', APP_COMMANDS.DEVTOOLS_OPEN, async () => {
    await webview.openDevTools()
    return true
  })
}
