import path from 'node:path'

/** 记录里的保存路径不可信：只允许下载根内的普通文件路径 */
export function resolvePathInside(root: string, candidate: string): string | null {
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(candidate)
  const relativePath = path.relative(resolvedRoot, target)
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null
  return target
}
