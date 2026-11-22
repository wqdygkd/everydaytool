// 任务轮询节奏：抽成纯函数，便于单测（store 只负责按结果排定时器）。
// 口径：抽屉打开时最快；有活跃任务按 1.5s；只剩历史任务与完全空闲时降频，减少 IPC 噪音。
export const POLL_DELAYS = {
  /** 下载任务抽屉打开：1s */
  drawer: 1000,
  /** 有排队 / 下载中 / 取消中的任务：1.5s */
  active: 1500,
  /** 没有活跃任务但还有历史任务：4s */
  history: 4000,
  /** 一个任务都没有：6s */
  idle: 6000,
} as const

export interface PollState {
  /** 下载任务抽屉是否打开 */
  drawerOpen: boolean
  /** 排队 / 下载中 / 取消中的任务数 */
  activeTasks: number
  /** 已知任务总数（含历史） */
  knownTasks: number
}

export function pollDelayMs(state: PollState): number {
  if (state.drawerOpen) return POLL_DELAYS.drawer
  if (state.activeTasks > 0) return POLL_DELAYS.active
  if (state.knownTasks > 0) return POLL_DELAYS.history
  return POLL_DELAYS.idle
}
