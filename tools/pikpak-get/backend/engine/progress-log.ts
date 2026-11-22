// 进度日志的格式化：纯函数，无 IO / 无 Electron / 无进程依赖（单测见 tests/progress-log.test.ts）。
// 引擎把同样的「任务计划 + 当前文件进度」写进 stdout（docker compose logs 可见）并回传 app。
export const PROGRESS_PREFIX = '[pikpak-get]'

/** 队列快照：还在排队（queued）的任务数 / 计划文件数 / 计划字节数 */
export interface QueueSummary {
  tasks: number
  files: number
  bytes: number
}

export function formatBytes(nbytes: number): string {
  let value = Number(nbytes) || 0
  let unit = 'B'
  for (const next of ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']) {
    unit = next
    if (Math.abs(value) < 1024 || next === 'PiB') break
    value /= 1024
  }
  return `${value.toFixed(1)}${unit}`
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(Math.max(0, bytesPerSecond))}/s`
}

/** 秒 → `03:12` / `1:03:12` */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(rest).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 未知总量时不编百分比 */
export function formatPercent(done: number, total: number): string {
  if (!total || total <= 0) return '--'
  return `${Math.min(100, Math.max(0, (done / total) * 100)).toFixed(1)}%`
}

export function formatQueue(queue: QueueSummary): string {
  if (queue.tasks <= 0) return '队列空闲'
  return `排队 ${queue.tasks} 个任务 · ${queue.files} 个文件 · ${formatBytes(queue.bytes)}`
}

/** 每行都以「正文｜队列快照」结尾，避免四个格式化函数各写一遍分隔符 */
function withQueue(body: string, queue: QueueSummary): string {
  return `${PROGRESS_PREFIX} ${body}｜${formatQueue(queue)}`
}

export function formatTaskQueued(taskId: string, files: number, bytes: number, queue: QueueSummary): string {
  return withQueue(`入队 ${taskId}（${files} 个文件 · ${formatBytes(bytes)}）`, queue)
}

export function formatTaskStart(taskId: string, files: number, bytes: number, queue: QueueSummary): string {
  return withQueue(`开始 ${taskId}（${files} 个文件 · ${formatBytes(bytes)}）`, queue)
}

export function formatFileStart(index: number, count: number, name: string, size: number, queue: QueueSummary): string {
  return withQueue(`下载中 ${index}/${count} ${name}（${formatBytes(size)}）`, queue)
}

export function formatFileProgress(
  index: number,
  count: number,
  name: string,
  done: number,
  size: number,
  speed: number,
  eta: number,
  queue: QueueSummary,
): string {
  const progress = `${formatPercent(done, size)} ${formatSpeed(speed)} 剩余 ${formatDuration(eta)}`
  return withQueue(`下载中 ${index}/${count} ${name} ${progress}`, queue)
}

export function formatFileDone(index: number, count: number, name: string, size: number, seconds: number): string {
  const average = seconds > 0 ? size / seconds : 0
  return `${PROGRESS_PREFIX} 完成 ${index}/${count} ${name}（${formatBytes(size)} 用时 ${formatDuration(seconds)} 均速 ${formatSpeed(average)}）`
}

export function formatTaskEnd(taskId: string, status: string, doneFiles: number, plannedFiles: number, queue: QueueSummary): string {
  return withQueue(`结束 ${taskId} ${status}（${doneFiles}/${plannedFiles} 个文件）`, queue)
}
