// interceptor 视图 / 规则类型与路由的映射：路由即视图状态，URL 可深链、前进后退可用。
// 路由表本体在 index.ts 的 subRoutes（经 ui/router/routes.ts 拍平），此处只放
// 页面导航与路由解析共用的映射，避免三处（页面 / 规则面板 / 注册）各写一份路径。
import type { RuleType } from '../../shared/interceptor'
import { RULE_TYPE_LABELS } from '../../shared/interceptor'

export type InterceptorTabKey = 'status' | 'targets' | 'rules' | 'traffic'

export interface InterceptorTabDef {
  key: InterceptorTabKey
  label: string
  routeName: string
}

export const INTERCEPTOR_TOOL_ROOT = '/tools/interceptor'

/** 视图顺序即展示顺序（页面上的按钮组按此渲染）；主路由重定向到第一项（status） */
export const INTERCEPTOR_TABS: readonly InterceptorTabDef[] = [
  { key: 'status', label: '状态', routeName: 'tool-interceptor-status' },
  { key: 'targets', label: '处理名单', routeName: 'tool-interceptor-targets' },
  { key: 'rules', label: '规则', routeName: 'tool-interceptor-rules' },
  { key: 'traffic', label: '流量', routeName: 'tool-interceptor-traffic' },
]

/** 全部规则类型（顺序同 RULE_TYPE_LABELS 声明序） */
export const RULE_TYPES = Object.keys(RULE_TYPE_LABELS) as RuleType[]

/** 规则类型列表路由：/tools/interceptor/rules/<type> */
export function ruleTypeRouteName(type: RuleType): string {
  return `tool-interceptor-rules-${type}`
}

/** 从路由 path 解析当前视图；非法 / 缺失回落 status */
export function tabKeyFromPath(path: string): InterceptorTabKey {
  const prefix = `${INTERCEPTOR_TOOL_ROOT}/`
  const segment = path.startsWith(prefix) ? path.slice(prefix.length).split('/')[0] : ''
  return INTERCEPTOR_TABS.find(tab => tab.key === segment)?.key ?? 'status'
}

/** 从路由 path 解析规则类型过滤（仅 /rules/<type> 命中；非类型路径返回 null） */
export function ruleTypeFromPath(path: string): RuleType | null {
  const prefix = `${INTERCEPTOR_TOOL_ROOT}/rules/`
  if (!path.startsWith(prefix)) return null
  const segment = path.slice(prefix.length).split('/')[0]
  return RULE_TYPES.includes(segment as RuleType) ? segment as RuleType : null
}
