// PikPak 下载（pikpak-get）—— 控制面与引擎之间的共享纯类型 / 常量 / 纯函数。
// 只放纯类型与纯函数（不依赖 Electron / Node / 文件系统），引擎 HTTP 契约见 docs/pikpak-get.md。
export type PikpakGetEngineMode = 'local' | 'nas'

export interface PikpakGetConnectionView {
  mode: PikpakGetEngineMode
  name: string
  url: string
  hasToken: boolean
}

export interface PikpakGetConnectionInput {
  mode?: PikpakGetEngineMode
  name?: string
  url?: string
  /** 空 / 未传表示保留已有 token */
  token?: string
}

export interface PikpakGetTraffic {
  cappedAt: number | null
  retryAt: number | null
  remaining: number
}

export interface PikpakGetAccount {
  id: string
  label: string
  trafficCappedAt: number | null
  createdAt: string
  updatedAt: string
  traffic: PikpakGetTraffic
}

export interface PikpakGetWhoami {
  usage: number
  limit: number
  inTrash: number
  free: number
  expiresAt: string
}

export interface PikpakGetLink {
  id: string
  url: string
  title: string
  folder: string
  shareId: string
  passCode: string
  rootId: string
  createdAt: string
  updatedAt: string
  parsedAt: string | null
}

export interface PikpakGetNode {
  id: string
  name: string
  path: string
  parentId: string
  isFolder: boolean
  size: number
  hash: string | null
  mime: string
  childCount?: number | null
  downloaded: boolean
  exists: boolean
}

export interface PikpakGetParseResult {
  linkId: string
  title: string
  fileNum: number | null
  truncated: boolean
  nodes: PikpakGetNode[]
  parsedAt: string | null
}

export interface PikpakGetExport {
  format: string
  version: number
  masterKey: string
  files: Record<string, string>
  exportedAt: string
}

export interface PikpakGetTaskFile {
  nodeId: string
  name: string
  size: number
  downloaded: number
  speed: number
  eta: number
}

export type PikpakGetTaskStatus
  = | 'queued'
    | 'running'
    | 'cancelling'
    | 'done'
    | 'partial'
    | 'error'
    | 'cancelled'

export interface PikpakGetTaskLog {
  ts: string
  level: string
  message: string
}

export interface PikpakGetTask {
  id: string
  linkId: string
  fileIds: string[] | null
  dest: string
  accountId: string | null
  status: PikpakGetTaskStatus
  currentFile: string | null
  files: Record<string, PikpakGetTaskFile>
  logs: PikpakGetTaskLog[]
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface PikpakGetEngineInfo {
  name: string
  version: string
  dest: string
  accounts: number
  links: number
}

export interface PikpakGetTaskInput {
  linkId: string
  fileIds?: string[] | null
  dest?: string | null
  accountId?: string | null
}

/** 二进制单位（与 PikpakGet 的 human() 口径一致：GiB，不是 GB） */
export function humanPikpakBytes(nbytes: number): string {
  const value = Number(nbytes) || 0
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let v = value
  let unit = units[0]
  for (const next of units) {
    unit = next
    if (Math.abs(v) < 1024 || next === 'PiB') break
    v /= 1024
  }
  return `${v.toFixed(1)}${unit}`
}

/** 解析结果每层的排序方式；`default` 保留引擎给的原始顺序 */
export type PikpakGetNodeSortKey = 'default' | 'name' | 'size' | 'ext'

/** 文件名排序用（数字感知：「第2集」排在「第10集」前），与资源管理器口径一致 */
const NODE_NAME_COLLATOR = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

/** 取文件名后缀（小写、不含点）；没有后缀或隐藏文件返回空串 */
export function pikpakNodeExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * 同一层节点的排序：**文件夹恒在文件之前**，`desc` 只翻转同组内顺序。
 * 返回新数组，不改动入参（渲染层直接吃 computed 结果）。
 */
export function sortPikpakNodes(nodes: readonly PikpakGetNode[], key: PikpakGetNodeSortKey, desc = false): PikpakGetNode[] {
  const list = [...nodes]
  if (key === 'default') return list
  const factor = desc ? -1 : 1
  return list.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    if (key === 'name') return NODE_NAME_COLLATOR.compare(a.name, b.name) * factor
    if (key === 'size') return ((a.size - b.size) || NODE_NAME_COLLATOR.compare(a.name, b.name)) * factor
    const byExt = NODE_NAME_COLLATOR.compare(pikpakNodeExtension(a.name), pikpakNodeExtension(b.name))
    return (byExt || NODE_NAME_COLLATOR.compare(a.name, b.name)) * factor
  })
}
