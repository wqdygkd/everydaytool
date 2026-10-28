// 平台级（应用壳）IPC 处理器：数据根目录的查看 / 更改 / 打开、分层用量、缓存清理、
// 窗口外观（半透明 / 系统材质）的读取与切换、UI 偏好、备份与恢复、打开调试控制台。
// 数据目录 / 资产目录的切换都只写 pending，实际迁移与生效在下次启动的 ready 之前完成。
import type {
  AppAssetsDirectoryInfo,
  AppAssetsDirectoryUpdateResult,
  AppDataDirectoryInfo,
  AppDataDirectoryUpdateResult,
  CacheCleanResult,
  DataUsage,
  UiPreferences,
} from '../../shared/app.ts'
import type { WindowAppearance, WindowAppearanceCapabilities, WindowAppearanceUpdate } from '../../shared/appearance.ts'
import type {
  BackupExportOptions,
  BackupExportResult,
  BackupInspectResult,
  BackupRestoreReport,
} from '../../shared/backup.ts'
import type { WindowBoundsState } from '../../shared/window-bounds.ts'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron'
import { formatBackupFileName } from '../../shared/backup.ts'
import { getWindowAppearance, updateWindowAppearance } from '../utils/appearance-store.ts'
import { getAssetsRootState, requestAssetsRootChange } from '../utils/assets-root.ts'
import { createBackup, inspectBackup, restoreBackup } from '../utils/backup-service.ts'
import { clearDataLayerCaches, scanDataLayers } from '../utils/data-root-scan.ts'
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
import { getUiPreferences, setUiPreferences } from '../utils/ui-preferences-store.ts'
import { getWindowBoundsState } from '../utils/window-bounds-store.ts'
import { EDT_APP_IPC_CHANNELS } from './channels.ts'

export interface AppIpcOptions {
  /** 外观变更后由 main.ts 应用到真实窗口，并回推最新值给渲染层 */
  applyWindowAppearance: (appearance: WindowAppearance) => void
  /** 平台能力由 main.ts 注入（需要读 process.platform / Windows build） */
  getAppearanceCapabilities: () => WindowAppearanceCapabilities
  /** 记忆开关由 main.ts 落地：开启瞬间补记一次当前几何，否则会恢复成关闭前的老位置 */
  setWindowBoundsEnabled: (enabled: boolean) => WindowBoundsState
  /** 重置记录并把当前窗口收回默认尺寸并居中（要操作真实窗口，故由 main.ts 注入） */
  resetWindowBounds: () => WindowBoundsState
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

  // ── 资产根：独立于数据目录（默认 <data>/assets，可指到另一块盘）──
  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.ASSETS_DIRECTORY_GET, (): AppAssetsDirectoryInfo => getAssetsRootState())

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.ASSETS_DIRECTORY_SELECT, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择资产目录（归档存储位置）',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.ASSETS_DIRECTORY_UPDATE, async (_event, nextDirectory: string): Promise<AppAssetsDirectoryUpdateResult> => {
    // 与数据目录同理：该目录会承载递归复制与删除，先做路径边界校验
    const result = await requestAssetsRootChange(nextDirectory)
    if (result.changed) logger.info('Assets directory change pending restart', { target: result.pendingAssetsRoot })
    return result
  })

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.ASSETS_DIRECTORY_OPEN, async () => {
    const assetsRoot = getAssetsRootState().assetsRoot
    const errorMessage = await shell.openPath(assetsRoot)
    if (errorMessage) {
      logger.warn('Failed to open assets directory', { error: errorMessage })
      throw new Error(errorMessage)
    }
    return true
  })

  // ── 应用壳 UI 偏好（收藏的工具 / 首页工具顺序）：配置层文件为事实来源 ──
  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.UI_PREFERENCES_GET, (): UiPreferences => getUiPreferences())

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.UI_PREFERENCES_SET, (_event, patch: { favoriteToolIds?: unknown, toolOrder?: unknown }): UiPreferences => {
    if (!patch || typeof patch !== 'object') throw new Error('偏好参数不合法')
    return setUiPreferences({ favoriteToolIds: patch.favoriteToolIds, toolOrder: patch.toolOrder })
  })

  // ── 备份包：导出 / 预检 / 恢复 ──
  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.BACKUP_EXPORT, async (_event, options: BackupExportOptions): Promise<BackupExportResult | null> => {
    const result = await dialog.showSaveDialog({
      title: '导出备份',
      defaultPath: path.join(app.getPath('documents'), formatBackupFileName(app.getVersion())),
      filters: [{ name: 'everydaytool 备份', extensions: ['edtbackup'] }],
    })
    if (result.canceled || !result.filePath) return null
    return createBackup(result.filePath, options ?? {})
  })

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.BACKUP_INSPECT, async (_event, payload: { filePath?: string | null, password?: string | null } | null): Promise<BackupInspectResult | null> => {
    let filePath = typeof payload?.filePath === 'string' && payload.filePath ? payload.filePath : null
    if (!filePath) {
      const picked = await dialog.showOpenDialog({
        title: '选择备份包',
        properties: ['openFile'],
        filters: [{ name: 'everydaytool 备份', extensions: ['edtbackup'] }],
      })
      if (picked.canceled || !picked.filePaths[0]) return null
      filePath = picked.filePaths[0]
    }
    return inspectBackup(filePath, { password: payload?.password ?? undefined })
  })

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.BACKUP_RESTORE, async (_event, payload: { filePath: string, password?: string | null, includeSession?: boolean }): Promise<BackupRestoreReport> => {
    if (!payload || typeof payload.filePath !== 'string' || !payload.filePath) throw new Error('缺少备份包路径')
    return restoreBackup(payload.filePath, {
      password: payload.password ?? undefined,
      includeSession: payload.includeSession === true,
    })
  })

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.DATA_USAGE_GET, async (): Promise<DataUsage> => {
    // cacheDirs 是清理用的内部字段，不进 IPC 载荷
    const { cacheDirs: _cacheDirs, ...usage } = await scanDataLayers()
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

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.WINDOW_BOUNDS_GET, (): WindowBoundsState => getWindowBoundsState())

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.WINDOW_BOUNDS_SET, (_event, enabled: unknown): WindowBoundsState => {
    // 渲染层只能开关记忆；具体几何由主进程在 move / resize 时自己记（渲染层拿不到可靠值）
    if (typeof enabled !== 'boolean') throw new Error('参数不合法')
    return options.setWindowBoundsEnabled(enabled)
  })

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.WINDOW_BOUNDS_RESET, (): WindowBoundsState => options.resetWindowBounds())

  safeHandle(ipcMain, EDT_APP_IPC_CHANNELS.CACHE_CLEAR, async (): Promise<CacheCleanResult> => {
    const result = await clearDataLayerCaches()
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
