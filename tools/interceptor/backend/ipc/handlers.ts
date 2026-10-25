// interceptor IPC 处理器：渲染层管理页与后端服务的唯一通道。
// 载荷在进服务层前做结构校验：规则 / 开关补丁来自渲染层，坏形态落到规则引擎会静默失效，
// 这里只放行字段类型正确的数据（文本长度另设上限，避免异常大对象直接落盘）。
import type { InterceptorRule, InterceptorTarget, ProxyPortUpdateResult, RuleType } from '../../../../shared/interceptor.ts'
import type { TargetPatch } from '../services/interceptor-service.ts'
import { dialog, ipcMain, shell } from 'electron'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { RULE_TYPE_LABELS } from '../../../../shared/interceptor.ts'
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

const RULE_TYPES = new Set<string>(Object.keys(RULE_TYPE_LABELS))
const MAX_ID_LENGTH = 200
const MAX_NAME_LENGTH = 500
const MAX_DESCRIPTION_LENGTH = 2_000

function requirePlainObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`参数不合法：${field}`)
  }
  return value as Record<string, unknown>
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`参数不合法：${field}`)
  return value
}

function requireIdLike(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_ID_LENGTH) {
    throw new Error(`参数不合法：${field}`)
  }
  return value
}

/** IPC 边界的规则结构校验：类型枚举 / 必填字段 / 文本长度；子配置只校验「是普通对象」 */
function assertInterceptorRule(value: unknown): InterceptorRule {
  const rule = requirePlainObject(value, 'rule')
  const type = requireIdLike(rule.type, 'rule.type')
  if (!RULE_TYPES.has(type)) throw new Error('参数不合法：rule.type')

  const name = requireIdLike(rule.name, 'rule.name')
  if (name.length > MAX_NAME_LENGTH) throw new Error('参数不合法：rule.name')

  for (const key of ['filters', 'redirect', 'replace', 'queryParam', 'delay', 'headers', 'userAgent', 'request', 'response', 'script'] as const) {
    if (rule[key] !== undefined) requirePlainObject(rule[key], `rule.${key}`)
  }
  if (rule.description !== undefined && (typeof rule.description !== 'string' || rule.description.length > MAX_DESCRIPTION_LENGTH)) {
    throw new Error('参数不合法：rule.description')
  }
  if (rule.pinned !== undefined) requireBoolean(rule.pinned, 'rule.pinned')

  return {
    ...rule,
    id: requireIdLike(rule.id, 'rule.id'),
    name,
    enabled: requireBoolean(rule.enabled, 'rule.enabled'),
    type: type as RuleType,
    updatedAt: typeof rule.updatedAt === 'string' && rule.updatedAt ? rule.updatedAt : new Date().toISOString(),
  } as InterceptorRule
}

/** 名单开关补丁：只接受 enabled / noCache 两个布尔字段（未提供任何字段视为非法） */
function assertTargetPatch(value: unknown): TargetPatch {
  const patch = requirePlainObject(value, 'patch')
  const next: TargetPatch = {}
  if (patch.enabled !== undefined) next.enabled = requireBoolean(patch.enabled, 'patch.enabled')
  if (patch.noCache !== undefined) next.noCache = requireBoolean(patch.noCache, 'patch.noCache')
  if (next.enabled === undefined && next.noCache === undefined) throw new Error('参数不合法：patch 不能为空')
  return next
}

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
    origin: unknown,
  ): Promise<{ targets: InterceptorTarget[], target: InterceptorTarget | null, existed: boolean }> => {
    const result = await addTarget(requireIdLike(origin, 'origin'))
    return { targets: getTargets(), target: result.target, existed: result.existed }
  })
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.TARGETS_REMOVE, async (_event, targetId: unknown): Promise<InterceptorTarget[]> => {
    await removeTargetById(requireIdLike(targetId, 'targetId'))
    return getTargets()
  })
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.TARGETS_TOGGLE, async (_event, targetId: unknown, patch: unknown): Promise<InterceptorTarget[]> => {
    await updateTarget(requireIdLike(targetId, 'targetId'), assertTargetPatch(patch))
    return getTargets()
  })

  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.RULES_GET, async (): Promise<InterceptorRule[]> => {
    await loadRules()
    return getRulesSnapshot()
  })
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.RULES_UPSERT, async (_event, rule: unknown): Promise<InterceptorRule[]> => {
    await saveRule(assertInterceptorRule(rule))
    return getRulesSnapshot()
  })
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.RULES_DELETE, async (_event, ruleId: unknown): Promise<InterceptorRule[]> => {
    await removeRule(requireIdLike(ruleId, 'ruleId'))
    return getRulesSnapshot()
  })

  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.TRAFFIC_GET, () => interceptorService.getTraffic())
  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.TRAFFIC_CLEAR, () => {
    interceptorService.clearTraffic()
    return true
  })

  safeHandle(ipcMain, INTERCEPTOR_IPC_CHANNELS.PROXY_SET_DESIRED, (_event, enabled: unknown) => setProxyDesired(requireBoolean(enabled, 'enabled')))

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
