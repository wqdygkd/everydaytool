import type { RouteRecordRaw } from 'vue-router'

export type ToolClientTarget = 'web' | 'win' | 'mac'

export interface ToolCategory {
  key: string
  name: string
}

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
    component: unknown
    meta?: { toolId?: string, title?: string }
  }
}

export interface ToolCategoryGroup {
  category: ToolCategory
  tools: ToolDefinition[]
}

export type ToolRoute = RouteRecordRaw
