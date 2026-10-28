import type { ToolDefinition } from '../types/tool'

// 首页工具顺序的纯逻辑：默认按创建时间倒序，用户拖拽后按保存的顺序，且不丢跨平台工具的槽位。
// 排序状态本身存配置层 app/ui-preferences.json（见 backend/utils/ui-preferences-store.ts）。

function createdAtValue(tool: ToolDefinition): number | null {
  if (!tool.createdAt) return null
  const value = Date.parse(tool.createdAt)
  return Number.isNaN(value) ? null : value
}

/**
 * 按创建时间倒序（最新在前）。
 * 缺 `createdAt` / 日期非法的工具排在最后，同日期保持注册表顺序（稳定排序）。
 */
export function sortToolsByCreatedAt(tools: readonly ToolDefinition[]): ToolDefinition[] {
  return tools
    .map((tool, index) => ({ tool, index, createdAt: createdAtValue(tool) }))
    .sort((a, b) => {
      if (a.createdAt === null || b.createdAt === null) {
        if (a.createdAt === null && b.createdAt === null) return a.index - b.index
        return a.createdAt === null ? 1 : -1
      }
      return b.createdAt - a.createdAt || a.index - b.index
    })
    .map(item => item.tool)
}

/**
 * 解析首页展示顺序：
 * - 保存过位置的工具按保存顺序排在原位（保存里已不存在的 id 忽略）；
 * - 没有保存位置的新工具（新装 / 之前只在别的平台可见）按创建时间倒序插到最前，
 *   保持「最新的排在最前面」这一默认语义。
 */
export function resolveToolOrder(tools: readonly ToolDefinition[], savedOrder: readonly string[]): ToolDefinition[] {
  const byId = new Map(tools.map(tool => [tool.id, tool]))
  const placed = new Set<string>()
  const ordered: ToolDefinition[] = []

  for (const id of savedOrder) {
    const tool = byId.get(id)
    if (!tool || placed.has(id)) continue
    placed.add(id)
    ordered.push(tool)
  }

  if (placed.size === tools.length) return ordered
  const fresh = sortToolsByCreatedAt(tools.filter(tool => !placed.has(tool.id)))
  return [...fresh, ...ordered]
}

export type ToolDropPosition = 'before' | 'after'

/**
 * 拖拽落位的纯计算：把 `sourceId` 插到 `targetId` 的前 / 后。
 * 位置没变（含 id 不存在 / 拖到自己身上）时返回 null，调用方据此跳过落盘。
 */
export function moveToolInOrder(
  order: readonly string[],
  sourceId: string,
  targetId: string,
  position: ToolDropPosition,
): string[] | null {
  const sourceIndex = order.indexOf(sourceId)
  const targetIndex = order.indexOf(targetId)
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return null

  let insertIndex = position === 'after' ? targetIndex + 1 : targetIndex
  if (sourceIndex < insertIndex) insertIndex -= 1
  if (insertIndex === sourceIndex) return null

  const next = [...order]
  next.splice(sourceIndex, 1)
  next.splice(insertIndex, 0, sourceId)
  return next
}

/**
 * 拖拽落盘前把「当前平台可见的顺序」套回已保存的全量顺序：
 * 不可见的 id（只在别的平台支持的工具）保留原来的相对位置，不会因为一次拖拽被丢掉。
 * 可见 id 在结果中的相对顺序与 `visibleOrder` 完全一致。
 */
export function mergeVisibleToolOrder(savedOrder: readonly string[], visibleOrder: readonly string[]): string[] {
  if (savedOrder.length === 0) return [...visibleOrder]

  const visible = new Set(visibleOrder)
  const merged: string[] = []
  let cursor = 0

  for (const id of savedOrder) {
    if (!visible.has(id)) {
      merged.push(id)
      continue
    }
    const next = visibleOrder[cursor]
    if (next) merged.push(next)
    cursor += 1
  }

  // 已保存顺序里没有槽位的新工具接在末尾（正常拖拽时它们已经包含在 savedOrder 里）
  while (cursor < visibleOrder.length) merged.push(visibleOrder[cursor++])

  return merged
}
