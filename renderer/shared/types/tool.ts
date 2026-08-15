import type { RouteRecordRaw } from 'vue-router';

export type ToolClientTarget = 'web' | 'win' | 'mac';

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  color: string;
  supportedTargets: readonly ToolClientTarget[];
  disabled?: boolean;
  route: {
    path: string;
    name: string;
    component: unknown;
    meta?: { toolId?: string };
  };
}

export type ToolRoute = RouteRecordRaw;
