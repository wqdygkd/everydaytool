import type { TreeaseInterceptRule } from '../../../../shared/types'

// 内置拦截规则：每个接口独立配置
// - modify：命中后解析 JSON 响应，按 JSON 路径覆盖指定字段，其余原样透传
// - block：请求阶段直接屏蔽（如 sentry.io 上报），不发出请求
export const BUILT_IN_RULES: TreeaseInterceptRule[] = [
  {
    id: 'usage',
    name: '用量接口',
    enabled: true,
    urlPattern: '*api.treease.com/v1/usage*',
    action: 'modify',
    patches: [
      { path: 'limits.aiProcessingMonthly.limit', value: 99999999 },
      { path: 'limits.graphViewDocumentsMonthly.limit', value: 99999999 },
      { path: 'limits.largeFileProcessingRunsMonthly.limit', value: 99999999 },
    ],
  },
  {
    id: 'sentry',
    name: '屏蔽 sentry 上报',
    enabled: true,
    urlPattern: '*sentry.io*',
    action: 'block',
    patches: [],
  },
]

/**
 * 合并本地存储与内置规则（按 id）：
 * - 本地已有的保留（含用户对内置规则的修改），顺序不变
 * - 内置新增（本地没有的 id）自动追加 → 代码里加规则后页面可见且生效
 */
export function mergeStoredRules(stored: TreeaseInterceptRule[]): TreeaseInterceptRule[] {
  const seen = new Set<string>()
  const merged: TreeaseInterceptRule[] = []
  for (const r of stored) {
    if (!r || typeof r.id !== 'string' || !r.id || seen.has(r.id)) continue
    merged.push(r)
    seen.add(r.id)
  }
  for (const b of BUILT_IN_RULES) {
    if (!seen.has(b.id)) {
      merged.push(structuredClone(b))
      seen.add(b.id)
    }
  }
  return merged.length ? merged : structuredClone(BUILT_IN_RULES)
}

export function freshBuiltInRules(): TreeaseInterceptRule[] {
  return structuredClone(BUILT_IN_RULES)
}
