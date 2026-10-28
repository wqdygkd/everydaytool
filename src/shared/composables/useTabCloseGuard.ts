/**
 * 页签关闭前守卫：工具页可注册异步确认（如「关闭将停止服务」）。
 * 返回 false 则取消关闭；未注册视为直接放行。
 */
type TabCloseGuard = () => boolean | Promise<boolean>

const guards = new Map<string, TabCloseGuard>()

export function registerTabCloseGuard(toolId: string, guard: TabCloseGuard): () => void {
  guards.set(toolId, guard)
  return () => {
    if (guards.get(toolId) === guard) guards.delete(toolId)
  }
}

export async function runTabCloseGuard(toolId: string): Promise<boolean> {
  const guard = guards.get(toolId)
  if (!guard) return true
  return await guard()
}
