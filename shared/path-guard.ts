// 路径边界守卫（主进程侧）：把递归删除、数据根目录切换等写操作限制在业务目录内，
// 避免数据库被篡改或接口字段扩大后误删/误写任意目录。
import path from 'node:path'
import process from 'node:process'

export interface PathGuardResult {
  ok: boolean
  reason?: string
}

/** 判断 target 是否位于 root 目录内（含 root 自身），自动规范化并阻断 `..` 逃逸 */
export function isPathWithin(root: string, target: string): PathGuardResult {
  if (!root || !target) return { ok: false, reason: '路径为空' }

  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  if (resolvedTarget === resolvedRoot) return { ok: true }

  const relative = path.relative(resolvedRoot, resolvedTarget)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { ok: false, reason: '目标路径超出允许范围' }
  }
  return { ok: true }
}

function normalizeForCompare(target: string): string {
  const normalized = path.resolve(target).replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** 数据根目录校验：绝对路径、非盘符根、不在已知系统目录内 */
export function isSafeDataDirectory(candidate: string): PathGuardResult {
  if (!candidate || !candidate.trim()) return { ok: false, reason: '数据目录不能为空' }
  if (!path.isAbsolute(candidate)) return { ok: false, reason: '数据目录必须是绝对路径' }
  if (candidate.length > 4096) return { ok: false, reason: '数据目录路径过长' }

  const resolved = path.resolve(candidate)
  if (path.dirname(resolved) === resolved) {
    return { ok: false, reason: '数据目录不能是磁盘根目录' }
  }

  const forbiddenRoots = [
    process.env.SYSTEMROOT,
    process.env.SYSTEMDRIVE ? `${process.env.SYSTEMDRIVE}\\Program Files` : undefined,
    process.env.SYSTEMDRIVE ? `${process.env.SYSTEMDRIVE}\\Program Files (x86)` : undefined,
    '/etc',
    '/usr',
    '/bin',
    '/sbin',
    '/System',
    '/Library',
    '/private',
  ].filter((item): item is string => Boolean(item))

  const normalized = normalizeForCompare(resolved)
  for (const forbidden of forbiddenRoots) {
    if (isPathWithin(forbidden, resolved).ok || normalized === normalizeForCompare(forbidden)) {
      return { ok: false, reason: '数据目录不能位于系统目录' }
    }
  }

  return { ok: true }
}
