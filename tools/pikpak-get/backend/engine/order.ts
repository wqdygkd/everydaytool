// 下载顺序：调用方给的 id 列表就是「界面上的顺序」，引擎按它排队，而不是按体积。
// 纯函数、无副作用，单测见 tests/order.test.ts。
export function orderBySelection<T extends { id: string }>(nodes: readonly T[], order: readonly string[] | null | undefined): T[] {
  if (!order || order.length === 0) return [...nodes]
  const rank = new Map<string, number>()
  for (const [index, id] of order.entries()) {
    if (!rank.has(id)) rank.set(id, index)
  }
  const known: T[] = []
  const rest: T[] = []
  for (const node of nodes) {
    if (rank.has(node.id)) known.push(node)
    else rest.push(node)
  }
  known.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  // 顺序表里没提到的文件（例如之后新增/截断）保持原有相对次序，排在后面
  return [...known, ...rest]
}
