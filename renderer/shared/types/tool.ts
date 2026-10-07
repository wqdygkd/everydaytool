import type { AsyncComponentLoader, Component } from 'vue'
import type { RouteRecordRaw } from 'vue-router'

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
}

/** 工具定义的输入形态：component 允许同步组件或异步加载器，由 defineTool 统一包装 */
export type ToolDefinitionInput = Omit<ToolDefinition, 'route' | 'isNew'> & {
  route: Omit<ToolDefinition['route'], 'component'> & {
    component: ToolRouteComponentInput
  }
}

export interface ToolCategoryGroup {
  category: ToolCategory
  tools: ToolDefinition[]
}
