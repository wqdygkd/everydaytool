// browser-bridge IPC 处理器：渲染层管理页与后端服务的唯一通道。
import type { BridgeRule, BridgeTarget, TargetMatchType } from '../../../../shared/browser-bridge.ts'
import { createRequire } from 'node:module'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import {
  addTarget,
  browserBridgeService,
  exportCaCert,
  getCaStatus,
  installCa,
  removeRule,
  removeTargetById,
  saveRule,
  setProxyDesired,
  uninstallCa,
} from '../services/bridge-service.ts'
import { getConfigSnapshot, loadConfig } from '../store/config-store.ts'
import { getRulesSnapshot, loadRules } from '../store/rules-store.ts'
import { CA_EXPORT_FILE_NAME } from '../utils/paths.ts'
import { BROWSER_BRIDGE_IPC_CHANNELS } from './channels.ts'

const require = createRequire(import.meta.url)
const { dialog, ipcMain, shell } = require('electron') as typeof import('electron')

export function registerBrowserBridgeHandlers(): void {
  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.STATUS_GET, () => browserBridgeService.getRuntimeStatus())

  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.CA_STATUS_GET, () => getCaStatus())
  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.CA_INSTALL, () => installCa())
  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.CA_UNINSTALL, () => uninstallCa())
  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.CA_EXPORT, async () => {
    const result = await dialog.showSaveDialog({
      title: '导出根证书（手动导入兜底用）',
      defaultPath: CA_EXPORT_FILE_NAME,
      filters: [{ name: '证书', extensions: ['crt', 'pem'] }],
    })
    if (result.canceled || !result.filePath) return null
    await exportCaCert(result.filePath)
    return result.filePath
  })

  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.TARGETS_GET, async (): Promise<BridgeTarget[]> => {
    await loadConfig()
    return getConfigSnapshot().targets
  })
  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.TARGETS_ADD, async (_event, host: string, port: number | undefined, matchType: TargetMatchType): Promise<BridgeTarget[]> => {
    await addTarget(host, port, matchType)
    return getConfigSnapshot().targets
  })
  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.TARGETS_REMOVE, async (_event, targetId: string): Promise<BridgeTarget[]> => {
    await removeTargetById(targetId)
    return getConfigSnapshot().targets
  })

  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.RULES_GET, async (): Promise<BridgeRule[]> => {
    await loadRules()
    return getRulesSnapshot()
  })
  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.RULES_UPSERT, async (_event, rule: BridgeRule): Promise<BridgeRule[]> => {
    await saveRule(rule)
    return getRulesSnapshot()
  })
  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.RULES_DELETE, async (_event, ruleId: string): Promise<BridgeRule[]> => {
    await removeRule(ruleId)
    return getRulesSnapshot()
  })

  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.TRAFFIC_GET, () => browserBridgeService.getTraffic())
  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.TRAFFIC_CLEAR, () => {
    browserBridgeService.clearTraffic()
    return true
  })

  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.PROXY_SET_DESIRED, (_event, enabled: boolean) => setProxyDesired(enabled))

  safeHandle(ipcMain, BROWSER_BRIDGE_IPC_CHANNELS.EXTENSION_OPEN_DIR, async () => {
    const { extensionDir } = browserBridgeService.getRuntimeStatus()
    if (!extensionDir) return false
    const errorMessage = await shell.openPath(extensionDir)
    if (errorMessage) {
      logger.warn('Failed to open extension directory', { error: errorMessage })
      return false
    }
    return true
  })
}
