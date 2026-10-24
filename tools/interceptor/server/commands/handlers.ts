// interceptor 命令处理器：渲染层管理页与后端服务的唯一通道。
import type { InterceptorRule, InterceptorTarget, ProxyPortUpdateResult } from '../../../../shared/interceptor.ts'
import type { TargetPatch } from '../services/interceptor-service.ts'
import { registerCommand } from '../../../../server/utils/commands.ts'
import { logger } from '../../../../server/utils/logger.ts'
import { fileDialog, system } from '../../../../server/utils/platform.ts'
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
import { INTERCEPTOR_COMMANDS } from './channels.ts'

export function registerInterceptorCommands(): void {
  registerCommand('interceptor', INTERCEPTOR_COMMANDS.STATUS_GET, () => interceptorService.getRuntimeStatus())

  registerCommand('interceptor', INTERCEPTOR_COMMANDS.CA_STATUS_GET, () => getCaStatus())
  registerCommand('interceptor', INTERCEPTOR_COMMANDS.CA_INSTALL, () => installCa())
  registerCommand('interceptor', INTERCEPTOR_COMMANDS.CA_UNINSTALL, () => uninstallCa())
  registerCommand('interceptor', INTERCEPTOR_COMMANDS.CA_EXPORT, async () => {
    const result = await fileDialog.save({
      title: '导出根证书（手动导入兜底用）',
      defaultPath: CA_EXPORT_FILE_NAME,
      filters: [{ name: '证书', extensions: ['crt', 'pem'] }],
    })
    if (result.canceled || !result.filePath) return null
    await exportCaCert(result.filePath)
    return result.filePath
  })

  registerCommand('interceptor', INTERCEPTOR_COMMANDS.TARGETS_GET, async (): Promise<InterceptorTarget[]> => {
    await loadConfig()
    return getTargets()
  })
  registerCommand('interceptor', INTERCEPTOR_COMMANDS.TARGETS_ADD, async (
    origin: string,
  ): Promise<{ targets: InterceptorTarget[], target: InterceptorTarget | null, existed: boolean }> => {
    const result = await addTarget(origin)
    return { targets: getTargets(), target: result.target, existed: result.existed }
  })
  registerCommand('interceptor', INTERCEPTOR_COMMANDS.TARGETS_REMOVE, async (targetId: string): Promise<InterceptorTarget[]> => {
    await removeTargetById(targetId)
    return getTargets()
  })
  registerCommand('interceptor', INTERCEPTOR_COMMANDS.TARGETS_TOGGLE, async (targetId: string, patch: TargetPatch): Promise<InterceptorTarget[]> => {
    await updateTarget(targetId, patch)
    return getTargets()
  })

  registerCommand('interceptor', INTERCEPTOR_COMMANDS.RULES_GET, async (): Promise<InterceptorRule[]> => {
    await loadRules()
    return getRulesSnapshot()
  })
  registerCommand('interceptor', INTERCEPTOR_COMMANDS.RULES_UPSERT, async (rule: InterceptorRule): Promise<InterceptorRule[]> => {
    await saveRule(rule)
    return getRulesSnapshot()
  })
  registerCommand('interceptor', INTERCEPTOR_COMMANDS.RULES_DELETE, async (ruleId: string): Promise<InterceptorRule[]> => {
    await removeRule(ruleId)
    return getRulesSnapshot()
  })

  registerCommand('interceptor', INTERCEPTOR_COMMANDS.TRAFFIC_GET, () => interceptorService.getTraffic())
  registerCommand('interceptor', INTERCEPTOR_COMMANDS.TRAFFIC_CLEAR, () => {
    interceptorService.clearTraffic()
    return true
  })

  registerCommand('interceptor', INTERCEPTOR_COMMANDS.PROXY_SET_DESIRED, (enabled: boolean) => setProxyDesired(enabled))

  registerCommand('interceptor', INTERCEPTOR_COMMANDS.PROXY_PORT_SET, async (port: number): Promise<ProxyPortUpdateResult> => {
    const result = await changeProxyPort(port)
    return { ...result, status: interceptorService.getRuntimeStatus() }
  })

  registerCommand('interceptor', INTERCEPTOR_COMMANDS.EXTENSION_OPEN_DIR, async () => {
    const { extensionDir } = interceptorService.getRuntimeStatus()
    if (!extensionDir) return false
    const errorMessage = await system.openPath(extensionDir)
    if (errorMessage) {
      logger.warn('Failed to open extension directory', { error: errorMessage })
      return false
    }
    return true
  })
}
