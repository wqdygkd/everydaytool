/**
 * 云枢 / eagleyun SASE 残留清理：IPC 通道与共享类型。
 * 通道字符串与类型由主进程、preload、渲染层共用，避免两侧漂移。
 */

export const YUNSHU_UNINSTALL_CHANNELS = {
  SCAN: 'yunshu-uninstall:scan',
  CLEAN: 'yunshu-uninstall:clean',
  OPEN_TRASH: 'yunshu-uninstall:open-trash',
  OPEN_KEYCHAIN: 'yunshu-uninstall:open-keychain',
  /** 主进程 → 渲染层的逐项进度（单向）；键名必须以 EVENT_ 开头，preload 才允许订阅 */
  EVENT_PROGRESS: 'yunshu-uninstall:progress',
} as const

/** 清理分组，顺序即执行顺序：先摘服务、再杀进程、再删文件、最后动证书 */
export type ResidueGroup = 'service' | 'process' | 'file' | 'certificate' | 'manual' | 'note'

export const RESIDUE_GROUP_LABELS: Record<ResidueGroup, string> = {
  service: '系统服务',
  process: '运行进程',
  file: '文件与目录',
  certificate: '根证书',
  manual: '需要手动处理',
  note: '无需处理',
}

/** 需要人工介入时的操作指引（工具自己的说明 + 可照做的步骤） */
export interface ResidueGuide {
  /** 为什么需要手动：自动删除失败、指纹不符、系统授权等 */
  reason: string
  steps: string[]
  /** 证书全指纹（带冒号），供用户与「钥匙串访问」里的值逐段核对 */
  fingerprint?: string
  /** 所在钥匙串（人话） */
  keychain?: string
  /** 指引里那条可复制的命令或路径 */
  copyValue?: string
}

export type ResidueStatus = 'pending' | 'running' | 'done' | 'failed' | 'kept' | 'absent'

export interface ResidueItem {
  /** 扫描产物内的稳定标识（group-index），清理时只认它，不接受渲染层传来的路径 */
  id: string
  group: ResidueGroup
  /** 展示用短名：路径做 ~ 缩写，服务用 label，进程用进程名 */
  label: string
  /** 绝对路径 / plist 路径 / 钥匙串路径 / 进程可执行路径 */
  path: string
  /** 类型文字：目录 / 文件 / 链接 / 守护进程 / 用户代理 / 进程 / 根证书 / 说明 */
  kindLabel: string
  /** 0 表示不适用（服务、进程、证书） */
  sizeBytes: number
  /** 删除它是否需要管理员授权 */
  needsAdmin: boolean
  /** false = 只提示，不参与清理（例如系统网络扩展配置记录） */
  removable: boolean
  /** 声明过的目标里，这一项在当前机器上是否存在；false 的行只做展示 */
  exists: boolean
  /** 补充说明：已加载 / PID 523 / 指纹一致 等 */
  detail: string
  /** 仅 manual 组：手动处理指引 */
  guide?: ResidueGuide
}

export interface ResidueScan {
  items: ResidueItem[]
  totalBytes: number
  scannedAt: string
  /** 被安全检查拦下、绝不会进入清理的路径（清单被改坏时会出现） */
  blocked: string[]
}

export interface CleanRequest {
  ids: string[]
}

export interface CleanItemResult {
  id: string
  status: ResidueStatus
  message: string
}

export interface CleanResult {
  results: CleanItemResult[]
  /** 是否弹过管理员授权 */
  escalated: boolean
  /** 清理后重新扫描的结果 */
  rescan: ResidueScan
}

export interface CleanProgress {
  id: string
  status: ResidueStatus
  message: string
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
