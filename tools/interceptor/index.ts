import type { RuleType } from '../../shared/interceptor'
import { defineTool } from '../../renderer/shared/tool/defineTool'
import { RULE_TYPE_LABELS } from '../../shared/interceptor'
import { INTERCEPTOR_TABS, ruleTypeRouteName } from './renderer/tabs'

const TOOL_ID = 'interceptor'

const ruleTypeSubRoutes = (Object.keys(RULE_TYPE_LABELS) as RuleType[]).map(type => ({
  path: `rules/${type}`,
  name: ruleTypeRouteName(type),
  meta: { title: `拦截器 · 规则 · ${RULE_TYPE_LABELS[type]}` },
}))

const tool = defineTool({
  id: TOOL_ID,
  name: '拦截器',
  description: '本地 MITM 代理：改包 / mock / 流量日志，配合浏览器扩展接管流量与脚本注入',
  version: '1.0.0',
  color: '#7c6cf0',
  icon: 'intercept',
  category: { key: 'browser', name: '浏览器工具' },
  keywords: ['proxy', 'mitm', 'interceptor', '代理', '抓包', '改包', 'mock', '拦截', '拦截器', '脚本注入'],
  supportedTargets: ['web', 'win', 'mac'],
  createdAt: '2026-10-17',
  route: {
    path: TOOL_ID,
    name: `tool-${TOOL_ID}`,
    component: () => import('./renderer/pages/InterceptorPage.vue'),
    meta: { toolId: TOOL_ID, title: '拦截器' },
  },
  // 每个页签、每个规则类型各一条路由（深链 / 前进后退）；
  // 主路由经 routes.ts 重定向到第一个子路由（status）
  subRoutes: [
    ...INTERCEPTOR_TABS.map(tab => ({
      path: tab.key,
      name: tab.routeName,
      meta: { title: `拦截器 · ${tab.label}` },
    })),
    ...ruleTypeSubRoutes,
  ],
})

export default tool
