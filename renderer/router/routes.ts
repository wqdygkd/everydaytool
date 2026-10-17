import type { RouteRecordRaw } from 'vue-router'
import type { ToolDefinition } from '../shared/types/tool'
import { allToolRegistry } from '../config/tools'
import HomePage from '../pages/HomePage.vue'

// 工具页全部常驻挂载（App.vue 里按 tab 做 v-show 显隐，webview 不离文档、不重建），
// 因此路由拍平为顶层，不再经过 ToolLayout 的嵌套 router-view + keep-alive
// （keep-alive 会把 DOM 移出文档，导致 webview guest 被销毁、切回重载）。
// 工具可用 subRoutes 声明页签 / 列表分类等深链：子路由继承主路由的组件与
// meta.toolId（页签高亮与常驻挂载依赖它），主路由重定向到第一个子路由，
// 保证同一状态只有一个规范 URL。
function toolRoutes(tool: ToolDefinition): RouteRecordRaw[] {
  const basePath = `/tools/${tool.route.path.replace(/^\//, '')}`
  const subRoutes = tool.subRoutes ?? []
  if (!subRoutes.length) {
    return [{ ...(tool.route as RouteRecordRaw), path: basePath }]
  }
  const subs: RouteRecordRaw[] = subRoutes.map(sub => ({
    ...(tool.route as RouteRecordRaw),
    ...sub,
    path: `${basePath}/${sub.path.replace(/^\//, '')}`,
    meta: { ...tool.route.meta, ...sub.meta },
  }))
  // 工具根路径重定向到第一个子路由：同一状态只有一个规范 URL。
  // 纯 redirect 记录（不带 component / meta）：重定向在组件加载前完成，
  // 该记录永远不会成为当前路由；name 保留，页签系统按 tool-<id> 跳转不会断
  const root: RouteRecordRaw = {
    name: tool.route.name,
    path: basePath,
    redirect: `${basePath}/${subRoutes[0].path.replace(/^\//, '')}`,
  }
  return [root, ...subs]
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomePage,
    meta: { title: 'everydaytool' },
  },
  ...allToolRegistry.flatMap(toolRoutes),
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]
