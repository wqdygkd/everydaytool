// 引擎内部形状（snake_case）→ shared 的 camelCase 视图。
// 只有纯字段搬运，不碰 Electron / 文件系统：本机 facade 拿的是引擎对象，NAS facade 拿的是
// 同一套引擎吐出的同名 JSON，两边必须共用这一份映射，否则渲染层会拿到 undefined
// （典型症状：parse.linkId 缺失 → 主进程 requireId 报「ID 非法」）。
import type {
  PikpakGetAccount,
  PikpakGetLink,
  PikpakGetNode,
  PikpakGetParseResult,
  PikpakGetTask,
  PikpakGetTaskInput,
  PikpakGetWhoami,
} from '../../../../shared/pikpak-get.ts'
import type { PikpakAccountView } from './accounts.ts'
import type { PikpakTask } from './engine.ts'
import type { PikpakLink } from './links.ts'
import type { PikpakNode } from './pipeline.ts'

export function mapAccount(item: PikpakAccountView): PikpakGetAccount {
  return {
    id: item.id,
    label: item.label,
    trafficCappedAt: item.traffic_capped_at,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    traffic: {
      cappedAt: item.traffic.capped_at,
      retryAt: item.traffic.retry_at,
      remaining: item.traffic.remaining,
    },
  }
}

export function mapWhoami(info: PikpakWhoamiRaw): PikpakGetWhoami {
  return { usage: info.usage, limit: info.limit, inTrash: info.in_trash, free: info.free, expiresAt: info.expires_at }
}

export function mapLink(item: PikpakLink): PikpakGetLink {
  return {
    id: item.id,
    url: item.url,
    title: item.title,
    folder: item.folder,
    shareId: item.share_id,
    passCode: item.pass_code,
    rootId: item.root_id,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    parsedAt: item.parsed_at,
  }
}

export function mapNode(node: PikpakNode): PikpakGetNode {
  return {
    id: node.id,
    name: node.name,
    path: node.path,
    parentId: node.parent_id,
    isFolder: node.is_folder,
    size: node.size,
    hash: node.hash,
    mime: node.mime,
    childCount: node.child_count ?? null,
    downloaded: node.downloaded === true,
    exists: node.exists === true,
  }
}

export function mapParseResult(result: PikpakParseRaw): PikpakGetParseResult {
  return {
    linkId: String(result.link_id ?? ''),
    title: String(result.title ?? ''),
    fileNum: result.file_num != null ? Number(result.file_num) : null,
    truncated: Boolean(result.truncated),
    nodes: (result.nodes ?? []).map(mapNode),
    parsedAt: typeof result.parsed_at === 'string' ? result.parsed_at : null,
  }
}

export function mapTask(task: PikpakTask): PikpakGetTask {
  return {
    id: task.id,
    linkId: task.link_id,
    fileIds: task.file_ids,
    dest: task.dest,
    accountId: task.account_id,
    status: task.status,
    currentFile: task.current_file,
    files: Object.fromEntries(Object.entries(task.files).map(([key, value]) => [
      key,
      { nodeId: value.node_id, name: value.name, size: value.size, downloaded: value.downloaded, speed: value.speed ?? 0, eta: value.eta ?? 0 },
    ])),
    logs: task.logs,
    error: task.error,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    plannedFiles: task.planned_files ?? (task.file_ids?.length ?? 0),
    plannedBytes: task.planned_bytes ?? 0,
  }
}

// ------------------------------------------------------------------ 引擎原始形状
// NAS 侧是 JSON，字段可能缺失；这里只描述「引擎确实会吐出的那部分」，缺省交给映射兜底。
export interface PikpakWhoamiRaw {
  usage: number
  limit: number
  in_trash: number
  free: number
  expires_at: string
}

export interface PikpakParseRaw {
  link_id?: string | null
  title?: string | null
  file_num?: number | string | null
  truncated?: boolean | null
  nodes?: PikpakNode[] | null
  parsed_at?: string | null
}

/** `POST /tasks` 的请求体（引擎服务按 snake_case 读取） */
export interface PikpakTaskRequestRaw {
  link_id: string
  file_ids: string[] | null
  dest: string | null
  account_id: string | null
}

/**
 * 请求方向同样要转换：引擎的 `POST /tasks` 按 `link_id` / `file_ids` / `account_id` 读体，
 * 直接发 camelCase 会被读成空串，报「分享链接不存在：」（detail 后面什么都没有）。
 * 空数组等价于「不筛选」，统一发 null。
 */
export function toEngineTaskInput(input: PikpakGetTaskInput): PikpakTaskRequestRaw {
  return {
    link_id: String(input.linkId),
    file_ids: input.fileIds?.length ? [...input.fileIds].map(String) : null,
    dest: input.dest ?? null,
    account_id: input.accountId ?? null,
  }
}
