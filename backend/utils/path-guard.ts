// 路径边界守卫（主进程侧）：把递归删除、数据根目录切换等写操作限制在业务目录内，
// 避免本地数据文件被篡改或接口字段扩大后误删/误写任意目录。
// 放在 backend/utils/ 而非 shared/：这里依赖 node:path / node:process，
// shared/ 只放可被渲染层安全引用的纯类型/常量/纯函数（见 AGENTS.md）。
import path from 'node:path'
import process from 'node:process'

export interface PathGuardResult {
  ok: boolean
  reason?: string
}

export interface PathRelation {
  /** 是否指向同一路径（Windows 下大小写无关） */
  same: boolean
  /** target 是否严格位于 root 目录内（不含相等） */
  inside: boolean
}

function normalizeForCompare(target: string): string {
  const normalized = path.resolve(target).replace(/\\/g, '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** 比较两个路径的关系；两侧都先做 resolve + 分隔符归一（跨盘符、`..` 逃逸都会落为不同/外部） */
export function comparePaths(root: string, target: string): PathRelation {
  const resolvedRoot = normalizeForCompare(root)
  const resolvedTarget = normalizeForCompare(target)
  if (resolvedRoot === resolvedTarget) return { same: true, inside: false }

  const relative = path.relative(resolvedRoot, resolvedTarget)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return { same: false, inside: false }
  }
  return { same: false, inside: true }
}

/** 两个路径是否指向同一位置（Windows 下大小写无关） */
export function isSamePath(a: string, b: string): boolean {
  return comparePaths(a, b).same
}

/** target 是否严格位于 root 内（不含相等；用于数据目录嵌套判定） */
export function isStrictlyWithin(root: string, target: string): boolean {
  return comparePaths(root, target).inside
}

/** 判断 target 是否位于 root 目录内（含 root 自身），自动规范化并阻断 `..` 逃逸 */
export function isPathWithin(root: string, target: string): PathGuardResult {
  if (!root || !target) return { ok: false, reason: '路径为空' }

  const relation = comparePaths(root, target)
  if (relation.same || relation.inside) return { ok: true }
  return { ok: false, reason: '目标路径超出允许范围' }
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

  for (const forbidden of forbiddenRoots) {
    if (isPathWithin(forbidden, resolved).ok) {
      return { ok: false, reason: '数据目录不能位于系统目录内' }
    }
  }

  return { ok: true }
}
