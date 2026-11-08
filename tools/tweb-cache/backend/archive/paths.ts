// tweb-cache 的磁盘布局（按「可不可再生」分层，见 docs/data-layers.md）：
//
//   <data>/config/tweb-cache/     config.json（站点端口）、archive-alias.json（等价缓存索引）、
//                                 peer-dirs.json（群目录名登记：<username>-peer-<id>）
//   <archive>/messages/           消息级缓存（manifest + message.md + 媒体）
//   <archive>/trash/              回收站
//   <data>/cache/tweb-cache/      objects/<ab>/<sha256>（按哈希去重的内容对象）
//                                 tmp/<task>.part（下载中临时文件）
//                                 diagnostics/（脱敏诊断包）
//
// `<archive>` 默认是 `<assets>/tweb-cache`，可由用户在工具内单独指定（config.json 的 archiveDir）；
// 只有 messages/ 与 trash/ 跟着走，索引和可再生对象仍在原来的分层位置。
//
// 索引兼容：media-index / messages-index 里的 `relativePath` 一律相对「工具命名空间」
// （即 tweb-cache/ 这一级，如 `objects/ab/hash`、`messages/…`），
// 由本文件的 resolveArchiveRelativePath / toArchiveRelativePath 按首段路由到对应层。
import type { DataLayer } from '../../../../shared/data-layers.ts'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveLayerPath, resolveLegacyPath } from '../../../../backend/utils/data-layers.ts'
import { getTwebCacheConfig } from '../store/config-store.ts'

const TOOL_ID = 'tweb-cache'

/** 归缓存层的首段（其余一律按配置层处理） */
const CACHE_HEADS = new Set(['objects', 'tmp', 'diagnostics'])
/** 归资产层的首段 */
const ASSET_HEADS = new Set(['messages', 'trash'])

/** 某层的工具命名空间根：`<layer>/tweb-cache` */
export function getArchiveToolRoot(layer: DataLayer): string {
  return resolveLayerPath(layer, TOOL_ID)
}

/** 缓存层：内容对象 / 临时文件 / 诊断包（可再生） */
export function getArchiveCacheRoot(): string {
  return getArchiveToolRoot('cache')
}

/** 配置层：索引与凭据（不可再生） */
export function getArchiveConfigRoot(): string {
  return getArchiveToolRoot('config')
}

/** 默认归档根：`<assets>/tweb-cache`（未单独自定义时使用） */
export function getDefaultArchiveDir(): string {
  return getArchiveToolRoot('assets')
}

/**
 * 当前归档根（`messages/` 与 `trash/` 的父目录）。
 * 用户可在工具内单独指定；未指定时回到资产层的工具命名空间。
 */
export function getArchiveDir(): string {
  return getTwebCacheConfig().archiveDir ?? getDefaultArchiveDir()
}

/** 资产层：消息级缓存目录（v4） */
export function getArchiveMessagesRoot(): string {
  return path.join(getArchiveDir(), 'messages')
}

/** 资产层：回收站（v4） */
export function getArchiveTrashRoot(): string {
  return path.join(getArchiveDir(), 'trash')
}

/** 配置层：消息索引（按 peer 分片）与媒体索引 */
export function getArchiveMessageIndexRoot(): string {
  return path.join(getArchiveConfigRoot(), 'messages-index')
}

export function getArchiveMediaIndexPath(): string {
  return path.join(getArchiveConfigRoot(), 'media-index.json')
}

export function getArchiveObjectsDir(): string {
  return path.join(getArchiveCacheRoot(), 'objects')
}

/** 记录里的相对路径 → 所属层的工具命名空间根（解析与越界校验共用同一来源） */
export function resolveArchiveRelativeRoot(relativePath: string): string {
  const head = relativePath.split('/')[0] ?? ''
  if (ASSET_HEADS.has(head)) return getArchiveDir()
  if (CACHE_HEADS.has(head)) return getArchiveToolRoot('cache')
  return getArchiveToolRoot('config')
}

/**
 * 记录里的相对路径 → 绝对路径。
 * v2 位置优先；某条目因布局升级失败仍留在 v1 平铺位置时回查旧根（否则会把「已下载」误判成「没下载」）。
 */
export function resolveArchiveRelativePath(relativePath: string): string {
  const primary = path.join(resolveArchiveRelativeRoot(relativePath), ...relativePath.split('/').filter(Boolean))
  if (existsSync(primary)) return primary
  // 自定义归档目录迁移失败 / 尚未完成时，旧位置仍在默认资产层：先回查，避免把「已下载」误判成「没下载」
  const head = relativePath.split('/')[0] ?? ''
  if (ASSET_HEADS.has(head) && getArchiveDir() !== getDefaultArchiveDir()) {
    const previous = path.join(getDefaultArchiveDir(), ...relativePath.split('/').filter(Boolean))
    if (existsSync(previous)) return previous
  }
  const legacy = path.join(resolveLegacyPath(TOOL_ID), ...relativePath.split('/').filter(Boolean))
  return existsSync(legacy) ? legacy : primary
}

/** 绝对路径 → 记录用的相对路径（相对工具命名空间，与 v1 索引格式一致） */
export function toArchiveRelativePath(absolutePath: string): string {
  const roots = [
    getArchiveDir(),
    getDefaultArchiveDir(),
    getArchiveToolRoot('config'),
    getArchiveToolRoot('cache'),
  ]
  for (const root of roots) {
    const relative = path.relative(root, absolutePath)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/')
    }
  }
  // 兜底：v1 平铺布局（升级失败时仍可能往旧位置写）
  return path.relative(resolveLegacyPath(TOOL_ID), absolutePath).split(path.sep).join('/')
}

/**
 * manifest / archive.meta 里的附件路径：相对**消息目录**（`media/<file>`）。
 * peer 目录改名时不用逐条改写 manifest。
 */
export function toMessageRelativePath(messageDir: string, absolutePath: string): string {
  return path.relative(messageDir, absolutePath).split(path.sep).join('/')
}

/**
 * 解析 manifest 里的附件路径，兼容旧格式 `messages/…/<mid>/media/<file>`
 * 与新格式 `media/<file>`。非法路径（含 `..`）返回 undefined。
 */
export function resolveMessageRelativePath(messageDir: string, relativePath: string): string | undefined {
  if (path.isAbsolute(relativePath) || /^[a-z]:/i.test(relativePath)) return undefined
  const parts = relativePath.split(/[\\/]/).filter(part => part && part !== '.')
  if (parts.includes('..')) return undefined
  // 旧格式可能带 `messages/<peerDir>/<mid>/` 甚至更早的 `messages/acc-<scope>/<peerDir>/<mid>/`：
  // 找到消息目录名那一段，取它后面的部分；新格式 `media/<file>` 则整段使用。
  const anchor = parts.indexOf(path.basename(messageDir))
  const inner = anchor >= 0 && anchor < parts.length - 1 ? parts.slice(anchor + 1) : parts
  if (inner.length === 0) return undefined
  return path.join(messageDir, ...inner)
}
