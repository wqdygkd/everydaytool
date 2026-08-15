import type { ToolClientTarget, ToolDefinition } from '../shared/types/tool.js';

export function getCurrentToolClientTarget(): ToolClientTarget {
  if (!window.chromeSandbox && !window.cdpInjector) {
    return 'web';
  }

  const platform = navigator.platform.toLowerCase();
  return platform.includes('mac') ? 'mac' : 'win';
}

export function isToolSupportedOnTarget(
  tool: ToolDefinition,
  target: ToolClientTarget = getCurrentToolClientTarget(),
): boolean {
  return tool.supportedTargets.includes(target);
}

export function filterToolsForCurrentTarget(tools: ToolDefinition[]): ToolDefinition[] {
  const target = getCurrentToolClientTarget();
  return tools.filter((tool) => !tool.disabled && isToolSupportedOnTarget(tool, target));
}
