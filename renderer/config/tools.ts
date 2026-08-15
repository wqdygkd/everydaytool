import type { ToolCategoryGroup, ToolDefinition } from '../shared/types/tool.js';
import chromeSandbox from '@tools/chrome-sandbox/index.js';
import idCardGenerator from '@tools/id-card-generator/index.js';
import cdpInjector from '@tools/cdp-injector/index.js';
import { filterToolsForCurrentTarget } from './toolAvailability.js';

export const allToolRegistry: ToolDefinition[] = [chromeSandbox, cdpInjector, idCardGenerator];
export const toolRegistry: ToolDefinition[] = filterToolsForCurrentTarget(allToolRegistry);
export const toolsByCategory: ToolCategoryGroup[] = groupToolsByCategory(toolRegistry);

export function getToolById(id: string): ToolDefinition | undefined {
  return toolRegistry.find((tool) => tool.id === id);
}

export function getActiveTools(): ToolDefinition[] {
  return toolRegistry.filter((tool) => !tool.disabled);
}

export function groupToolsByCategory(tools: ToolDefinition[]): ToolCategoryGroup[] {
  const groups = new Map<string, ToolCategoryGroup>();

  for (const tool of tools) {
    const group = groups.get(tool.category.key);
    if (group) {
      group.tools.push(tool);
      continue;
    }

    groups.set(tool.category.key, {
      category: tool.category,
      tools: [tool],
    });
  }

  return Array.from(groups.values());
}
