// interceptor IPC 处理器：渲染层管理页与后端服务的唯一通道。
import type { InterceptorRule, InterceptorTarget, ProxyPortUpdateResult } from '../../../../shared/interceptor.ts'
import type { TargetPatch } from '../services/interceptor-service.ts'
import { createRequire } from 'node:module'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import {
  addTarget,
  changeProxyPort,
  exportCaCert,
  getCaStatus,
  getTargets,
  installCa,
  interceptorService,
  removeRule,
  removeTargetById,
  saveRule,
  setProxyDesired,
  uninstallCa,
  updateTarget,
} from '../services/interceptor-service.ts'
import { loadConfig } from '../store/config-store.ts'
import { getRulesSnapshot, loadRules } from '../store/rules-store.ts'
import { CA_EXPORT_FILE_NAME } from '../utils/paths.ts'
import { INTERCEPTOR_IPC_CHANNELS } from './channels.ts'

const require = createRequire(import.meta.url)
const { dialog, ipcMain, shell } = require('electron') as typeof import('electron')

export function registerInterceptorHandlers(): void {
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.STATUS_GET, () => interceptorService.getRuntimeStatus())

  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.CA_STATUS_GET, () => getCaStatus())
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.CA_INSTALL, () => installCa())
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.CA_UNINSTALL, () => uninstallCa())
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.CA_EXPORT, async () => {
    const result = await dialog.showSaveDialog({
      title: '导出根证书（手动导入兜底用）',
      defaultPath: CA_EXPORT_FILE_NAME,
      filters: [{ name: '证书', extensions: ['crt', 'pem'] }],
    })
    if (result.canceled || !result.filePath) return null
    await exportCaCert(result.filePath)
    return result.filePath
  })

  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.TARGETS_GET, async (): Promise<InterceptorTarget[]> => {
    await loadConfig()
    return getTargets()
  })
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.TARGETS_ADD, async (
    _event,
    origin: string,
  ): Promise<{ targets: InterceptorTarget[], target: InterceptorTarget | null, existed: boolean }> => {
    const result = await addTarget(origin)
    return { targets: getTargets(), target: result.target, existed: result.existed }
  })
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.TARGETS_REMOVE, async (_event, targetId: string): Promise<InterceptorTarget[]> => {
    await removeTargetById(targetId)
    return getTargets()
  })
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.TARGETS_TOGGLE, async (_event, targetId: string, patch: TargetPatch): Promise<InterceptorTarget[]> => {
    await updateTarget(targetId, patch)
    return getTargets()
  })

  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.RULES_GET, async (): Promise<InterceptorRule[]> => {
    await loadRules()
    return getRulesSnapshot()
  })
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.RULES_UPSERT, async (_event, rule: InterceptorRule): Promise<InterceptorRule[]> => {
    await saveRule(rule)
    return getRulesSnapshot()
  })
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.RULES_DELETE, async (_event, ruleId: string): Promise<InterceptorRule[]> => {
    await removeRule(ruleId)
    return getRulesSnapshot()
  })

  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.TRAFFIC_GET, () => interceptorService.getTraffic())
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.TRAFFIC_CLEAR, () => {
    interceptorService.clearTraffic()
    return true
  })

  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.PROXY_SET_DESIRED, (_event, enabled: boolean) => setProxyDesired(enabled))

  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.PROXY_PORT_SET, async (_event, port: number): Promise<ProxyPortUpdateResult> => {
    const result = await changeProxyPort(port)
    return { ...result, status: interceptorService.getRuntimeStatus() }
  })

  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.EXTENSION_OPEN_DIR, async () => {
    const { extensionDir } = interceptorService.getRuntimeStatus()
    if (!extensionDir) return false
    const errorMessage = await shell.openPath(extensionDir)
    if (errorMessage) {
      logger.warn('Failed to open extension directory', { error: errorMessage })
      return false
    }
    return true
  })
}
