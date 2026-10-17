// browser-bridge 页签 / 规则类型与路由的映射：路由即页签状态，URL 可深链、前进后退可用。
// 路由表本体在 index.ts 的 subRoutes（经 renderer/router/routes.ts 拍平），此处只放
// 页面导航与路由解析共用的映射，避免三处（页面 / 规则面板 / 注册）各写一份路径。
import type { RuleType } from '../../../shared/browser-bridge'
import { RULE_TYPE_LABELS } from '../../../shared/browser-bridge'

export type BridgeTabKey = 'status' | 'targets' | 'rules' | 'traffic'

export interface BridgeTabDef {
  key: BridgeTabKey
  label: string
  routeName: string
}

export const BRIDGE_TOOL_ROOT = '/tools/browser-bridge'

/** 页签顺序即展示顺序；主路由重定向到第一项（status） */
export const BRIDGE_TABS: readonly BridgeTabDef[] = [
  { key: 'status', label: '状态', routeName: 'tool-browser-bridge-status' },
  { key: 'targets', label: '处理名单', routeName: 'tool-browser-bridge-targets' },
  { key: 'rules', label: '规则', routeName: 'tool-browser-bridge-rules' },
  { key: 'traffic', label: '流量', routeName: 'tool-browser-bridge-traffic' },
]

/** 全部规则类型（顺序同 RULE_TYPE_LABELS 声明序） */
export const RULE_TYPES = Object.keys(RULE_TYPE_LABELS) as RuleType[]

/** 规则类型列表路由：/tools/browser-bridge/rules/<type> */
export function ruleTypeRouteName(type: RuleType): string {
  return `tool-browser-bridge-rules-${type}`
}

/** 从路由 path 解析当前页签；非法 / 缺失回落 status */
export function tabKeyFromPath(path: string): BridgeTabKey {
  const prefix = `${BRIDGE_TOOL_ROOT}/`
  const segment = path.startsWith(prefix) ? path.slice(prefix.length).split('/')[0] : ''
  return BRIDGE_TABS.find(tab => tab.key === segment)?.key ?? 'status'
}

/** 从路由 path 解析规则类型过滤（仅 /rules/<type> 命中；非类型路径返回 null） */
export function ruleTypeFromPath(path: string): RuleType | null {
  const prefix = `${BRIDGE_TOOL_ROOT}/rules/`
  if (!path.startsWith(prefix)) return null
  const segment = path.slice(prefix.length).split('/')[0]
  return RULE_TYPES.includes(segment as RuleType) ? segment as RuleType : null
}
