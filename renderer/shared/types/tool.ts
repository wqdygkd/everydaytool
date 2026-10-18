import type { AsyncComponentLoader, Component } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import type { IconName } from '../components/ui/icons'

export type ToolClientTarget = 'web' | 'win' | 'mac'

export interface ToolCategory {
  key: string
  name: string
}

/** 工具定义输入：component 可以是同步组件、异步加载器或异步组件包装结果 */
export type ToolRouteComponentInput = Component | AsyncComponentLoader

export interface ToolDefinition {
  id: string
  name: string
  description: string
  version: string
  color: string
  /** 工具 logo 图标（icons.ts 图标名，展示在主页卡片头像内） */
  icon: IconName
  category: ToolCategory
  keywords: readonly string[]
  supportedTargets: readonly ToolClientTarget[]
  createdAt?: string
  isNew: boolean
  disabled?: boolean
  route: Omit<RouteRecordRaw, 'children'> & {
    path: string
    name: string
    /** 经 defineTool 统一包装为异步组件（工具页按需加载，不进主包） */
    component: Component
    meta?: { toolId?: string, title?: string }
  }
  /** 工具内子路由：拍平为 `/tools/<工具>/<子路径>`；声明后主路由重定向到第一个子路由 */
  subRoutes?: ToolSubRoute[]
}

/** 工具定义的输入形态：component 允许同步组件或异步加载器，由 defineTool 统一包装 */
export type ToolDefinitionInput = Omit<ToolDefinition, 'route' | 'isNew'> & {
  route: Omit<ToolDefinition['route'], 'component'> & {
    component: ToolRouteComponentInput
  }
}

/** 工具子路由（页签 / 列表分类等深链）：component 与 meta.toolId 继承自主路由 */
export interface ToolSubRoute {
  /** 相对工具根路径，如 'status' / 'rules/redirect' */
  path: string
  name: string
  meta?: { toolId?: string, title?: string }
}

export interface ToolCategoryGroup {
  category: ToolCategory
  tools: ToolDefinition[]
}
