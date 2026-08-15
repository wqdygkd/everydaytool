import type { ToolDefinition } from '../shared/types/tool.js';
import chromeSandbox from '@tools/chrome-sandbox/index.js';
import idCardGenerator from '@tools/id-card-generator/index.js';
import cdpInjector from '@tools/cdp-injector/index.js';

export const toolRegistry: ToolDefinition[] = [chromeSandbox, cdpInjector, idCardGenerator];

export function getToolById(id: string): ToolDefinition | undefined {
  return toolRegistry.find((tool) => tool.id === id);
}

export function getActiveTools(): ToolDefinition[] {
  return toolRegistry.filter((tool) => !tool.disabled);
}
