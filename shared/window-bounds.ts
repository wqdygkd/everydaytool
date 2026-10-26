// 窗口大小 / 位置（window bounds）域共享类型与纯逻辑：
// 主进程启动时按这里的结论决定是否恢复上次的几何——外接屏拔掉、分辨率变小后，
// 存档里的坐标可能落在屏幕之外，直接套用会把窗口还原到看不见的地方。
// 经 preload 命名空间 edtApp 暴露给设置页读取与重置。

/** 屏幕工作区矩形（Electron screen.Display.workArea 的子集，shared 不依赖 electron） */
export interface WindowArea {
  x: number
  y: number
  width: number
  height: number
}

/** 窗口几何；单位与 Electron 的 getNormalBounds 一致（DIP，随系统缩放换算） */
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowBoundsState {
  /** 关闭后不记录也不恢复，每次启动都用默认尺寸居中 */
  enabled: boolean
  /** 上次是否最大化：恢复时先按普通态几何建窗，再最大化 */
  maximized: boolean
  /** 上次的普通态几何（最大化 / 全屏状态下取的是还原后的尺寸）；null = 尚未记录 */
  bounds: WindowBounds | null
}

/** 首次启动 / 没有记录时的窗口尺寸（位置交给 Electron 居中） */
export const DEFAULT_WINDOW_SIZE = { width: 1200, height: 900 } as const

/** 与 BrowserWindow 的 minWidth / minHeight 一致 */
export const MIN_WINDOW_SIZE = { width: 800, height: 500 } as const

/**
 * 至少要在某块屏的工作区里留下这么多像素才算「还能拖回来」：
 * 只重叠几个像素的窗口点不到标题栏，等于丢在屏幕外。
 */
const MIN_RESTORE_VISIBLE = 120

export const DEFAULT_WINDOW_BOUNDS_STATE: WindowBoundsState = {
  enabled: true,
  maximized: false,
  bounds: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.round(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 只接受整数坐标；尺寸不足最小窗口时抬到最小值（配置文件可能被手改坏） */
export function sanitizeWindowBounds(value: unknown): WindowBounds | null {
  if (!isRecord(value)) return null
  const x = toInteger(value.x)
  const y = toInteger(value.y)
  const width = toInteger(value.width)
  const height = toInteger(value.height)
  if (x === null || y === null || width === null || height === null) return null
  return {
    x,
    y,
    width: Math.max(width, MIN_WINDOW_SIZE.width),
    height: Math.max(height, MIN_WINDOW_SIZE.height),
  }
}

/** 磁盘内容归一化：字段缺失 / 类型不对都退回默认值，不因为一个坏字段丢掉整份记录 */
export function sanitizeWindowBoundsState(value: unknown): WindowBoundsState {
  if (!isRecord(value)) return { ...DEFAULT_WINDOW_BOUNDS_STATE }
  return {
    // enabled 缺省视为开启：老版本没有这个字段时按「记住位置」处理
    enabled: value.enabled !== false,
    maximized: value.maximized === true,
    bounds: sanitizeWindowBounds(value.bounds),
  }
}

export interface WindowPlacement {
  bounds: WindowBounds
  maximized: boolean
}

/** 窗口与工作区的交集尺寸；任一维为负表示该方向没有交集 */
function overlapSize(bounds: WindowBounds, area: WindowArea): { width: number, height: number } {
  return {
    width: Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x),
    height: Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y),
  }
}

/**
 * 把存档里的几何换算成「这次启动真正要用的位置」：
 * - 未开启记忆 / 没有记录 / 记录已不可见（屏幕拔掉、分辨率变小）→ 返回 null，
 *   调用方按默认尺寸建窗（由 Electron 居中）；
 * - 否则在交集最大的那块屏上收敛尺寸与坐标，保证窗口完整落在工作区内。
 */
export function resolveWindowPlacement(
  state: WindowBoundsState,
  areas: WindowArea[],
): WindowPlacement | null {
  const bounds = state.bounds
  if (!state.enabled || !bounds) return null

  let target: WindowArea | null = null
  let targetOverlap = 0
  for (const area of areas) {
    const { width, height } = overlapSize(bounds, area)
    if (width <= 0 || height <= 0) continue
    const areaOverlap = width * height
    if (areaOverlap > targetOverlap) {
      target = area
      targetOverlap = areaOverlap
    }
  }
  if (!target) return null

  // 交集太小同样放弃：剩下一条边或一个角没法拖回来，不如回到默认位置
  const visible = overlapSize(bounds, target)
  if (visible.width < MIN_RESTORE_VISIBLE || visible.height < MIN_RESTORE_VISIBLE) return null

  // 屏幕比窗口小时以工作区为准（否则窗口右侧 / 底部会被裁在屏幕外）
  const width = Math.min(bounds.width, target.width)
  const height = Math.min(bounds.height, target.height)
  return {
    bounds: {
      x: clamp(bounds.x, target.x, target.x + target.width - width),
      y: clamp(bounds.y, target.y, target.y + target.height - height),
      width,
      height,
    },
    maximized: state.maximized,
  }
}
