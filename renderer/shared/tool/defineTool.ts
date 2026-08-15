import type { ToolDefinition } from '../types/tool.js';

type ToolDefinitionInput = Omit<ToolDefinition, 'isNew' | 'route'> & {
  isNew?: boolean;
  route: Omit<ToolDefinition['route'], 'name' | 'meta'> & {
    name?: string;
    meta?: ToolDefinition['route']['meta'];
  };
};

const NEW_TOOL_WINDOW_DAYS = 14;

function isRecentlyCreated(createdAt?: string): boolean {
  if (!createdAt) return false;

  const createdTime = new Date(createdAt).getTime();
  if (Number.isNaN(createdTime)) return false;

  const windowMs = NEW_TOOL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - createdTime <= windowMs;
}

export function defineTool(tool: ToolDefinitionInput): ToolDefinition {
  return {
    ...tool,
    isNew: tool.isNew ?? isRecentlyCreated(tool.createdAt),
    route: {
      ...tool.route,
      name: tool.route.name ?? `tool-${tool.id}`,
      meta: {
        ...tool.route.meta,
        toolId: tool.id,
        title: tool.route.meta?.title ?? tool.name,
      },
    },
  };
}
