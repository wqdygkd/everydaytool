// treease-editor 的拦截规则 / 开关（**配置层**：`<data>/config/treease-editor/rules.json`）。
//
// 为什么从 LocalStorage 搬到文件：规则是用户手写、不可再生的配置，LocalStorage 属于会话层
// （Chromium 拥有），既不会进备份包，也可能随清 session / 换数据目录丢失；v2 分层里它的家是配置层。
// LocalStorage 保留为**镜像**（网页预览没有 IPC 时的降级路径），文件是唯一事实来源。
import type { TreeaseInterceptRule } from '../../../../shared/treease.ts'
import { resolveLayerPath } from '../../../../backend/utils/data-layers.ts'
import { readJsonDocument, writeJsonDocument } from '../../../../backend/utils/json-store.ts'
import { logger } from '../../../../backend/utils/logger.ts'

export interface TreeaseRulesDocument {
  schemaVersion: 1
  rules: TreeaseInterceptRule[]
  /** 拦截总开关（与规则存在一起，避免两个文件时序不一致） */
  enabled: boolean
}

const EMPTY_DOCUMENT: TreeaseRulesDocument = { schemaVersion: 1, rules: [], enabled: true }
const MAX_RULES = 200
const MAX_PATCHES = 500

function getRulesPath(): string {
  return resolveLayerPath('config', 'treease-editor', 'rules.json')
}

/** 渲染层传上来的规则不可信：逐字段挑白名单，非法条目丢弃而不是整份失败 */
function sanitizeRules(input: unknown): TreeaseInterceptRule[] {
  if (!Array.isArray(input)) return []
  const rules: TreeaseInterceptRule[] = []
  for (const item of input.slice(0, MAX_RULES)) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const action = record.action === 'block' ? 'block' : record.action === 'modify' ? 'modify' : null
    if (!action) continue
    const patches = Array.isArray(record.patches)
      ? record.patches
          .slice(0, MAX_PATCHES)
          .filter((patch): patch is { path: string, value: unknown } =>
            typeof patch === 'object' && patch !== null && typeof (patch as Record<string, unknown>).path === 'string')
          .map(patch => ({ path: (patch as { path: string }).path, value: (patch as { value?: unknown }).value ?? '' }))
      : []
    rules.push({
      id: typeof record.id === 'string' && record.id ? record.id : `rule_${rules.length}`,
      name: typeof record.name === 'string' ? record.name : '',
      enabled: record.enabled !== false,
      urlPattern: typeof record.urlPattern === 'string' ? record.urlPattern : '',
      action,
      patches,
    })
  }
  return rules
}

export const treeaseRulesStore = {
  read(): TreeaseRulesDocument {
    const data = readJsonDocument<unknown>(getRulesPath(), () => ({ ...EMPTY_DOCUMENT }))
    if (typeof data !== 'object' || data === null) return { ...EMPTY_DOCUMENT }
    const record = data as Record<string, unknown>
    return {
      schemaVersion: 1,
      rules: sanitizeRules(record.rules),
      enabled: record.enabled !== false,
    }
  },

  write(rules: unknown, enabled: unknown): TreeaseRulesDocument {
    const document: TreeaseRulesDocument = {
      schemaVersion: 1,
      rules: sanitizeRules(rules),
      enabled: enabled !== false,
    }
    writeJsonDocument(getRulesPath(), document)
    logger.info('Treease intercept rules saved', { rules: document.rules.length, enabled: document.enabled })
    return document
  },
}
