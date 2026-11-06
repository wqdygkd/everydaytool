import type {
  SkillManagerSettings,
  SkillOrigin,
  TrashClearResult,
  TrashItemView,
  TrashListResult,
  TrashMutationResult,
} from '../../../../shared/skill-manager.ts'
import { lstat, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { exists, restoreTrashEntry } from './executor.ts'
import { DEFAULT_SKILL_MANAGER_SETTINGS } from './settings.ts'

interface ManifestEntry {
  name: string
  sourcePath: string
  trashPath: string
  origin?: SkillOrigin
  contentHash?: string
}

interface TrashManifest {
  version: 1
  id: string
  scopeId: string
  reason: string
  createdAt: string
  entries: ManifestEntry[]
}

function safePart(value: string): string {
  return value.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'skill'
}

function ageDays(iso: string): number {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return 0
  return Math.max(0, (Date.now() - time) / 86_400_000)
}

async function readManifest(path: string): Promise<TrashManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as TrashManifest
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return null
    return parsed
  }
  catch {
    return null
  }
}

async function sizeOf(path: string): Promise<number> {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink()) return 0
    if (info.isFile()) return info.size
    if (!info.isDirectory()) return 0
    let total = 0
    for (const entry of await readdir(path)) total += await sizeOf(join(path, entry))
    return total
  }
  catch {
    return 0
  }
}

function toView(manifest: TrashManifest, entry: ManifestEntry, sizeBytes: number, restorable: boolean): TrashItemView {
  return {
    operationId: manifest.id,
    scopeId: manifest.scopeId,
    reason: manifest.reason,
    createdAt: manifest.createdAt,
    name: entry.name,
    sourcePath: entry.sourcePath,
    trashPath: entry.trashPath,
    origin: entry.origin,
    contentHash: entry.contentHash,
    sizeBytes,
    ageDays: Number(ageDays(manifest.createdAt).toFixed(1)),
    restorable,
  }
}

export async function listTrash(root: string, settings: SkillManagerSettings = DEFAULT_SKILL_MANAGER_SETTINGS): Promise<TrashListResult> {
  const items: TrashItemView[] = []
  let totalBytes = 0
  try {
    const dirs = await readdir(root, { withFileTypes: true })
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue
      const manifest = await readManifest(join(root, dir.name, 'manifest.json'))
      if (!manifest) continue
      for (const entry of manifest.entries) {
        const size = await sizeOf(entry.trashPath)
        totalBytes += size
        items.push(toView(manifest, entry, size, !(await exists(entry.sourcePath))))
      }
    }
  }
  catch {}
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name))
  return {
    root,
    items,
    totalBytes,
    retentionDays: settings.trashRetentionDays,
    maxBytes: settings.trashMaxBytes,
  }
}

async function writeManifest(session: { manifestPath: string, id: string, scopeId: string, reason: string, createdAt: string, entries: ManifestEntry[] }): Promise<void> {
  await writeFile(session.manifestPath, `${JSON.stringify({
    version: 1,
    id: session.id,
    scopeId: session.scopeId,
    reason: session.reason,
    createdAt: session.createdAt,
    entries: session.entries,
  }, null, 2)}\n`, 'utf8')
}

async function locate(root: string, operationId: string, name: string): Promise<{ manifest: TrashManifest, entry: ManifestEntry, manifestPath: string } | null> {
  if (!/^[\w.-]+$/.test(operationId)) return null
  const manifestPath = join(root, operationId, 'manifest.json')
  const manifest = await readManifest(manifestPath)
  const entry = manifest?.entries.find(item => item.name === name)
  return manifest && entry ? { manifest, entry, manifestPath } : null
}

export async function restoreTrashItem(root: string, operationId: string, name: string): Promise<TrashMutationResult> {
  const found = await locate(root, operationId, name)
  if (!found) throw new Error('回收站条目不存在')
  if (!(await exists(found.entry.trashPath))) throw new Error('回收站文件已被清理')
  await restoreTrashEntry(found.entry)
  await removeManifestEntry(root, found.manifest, found.manifestPath, name)
  return {
    operationId,
    name,
    restored: true,
    targetPath: found.entry.sourcePath,
    warnings: ['仅恢复目录，锁记录未自动恢复；请重新安装或在更新计划中处理'],
  }
}

export async function deleteTrashItem(root: string, operationId: string, name: string): Promise<TrashMutationResult> {
  const found = await locate(root, operationId, name)
  if (!found) throw new Error('回收站条目不存在')
  const bytes = await sizeOf(found.entry.trashPath)
  await rm(found.entry.trashPath, { recursive: true, force: true })
  await removeManifestEntry(root, found.manifest, found.manifestPath, name)
  return { operationId, name, deleted: true, warnings: [`已永久删除 ${bytes} 字节`] }
}

async function removeManifestEntry(root: string, manifest: TrashManifest, manifestPath: string, name: string): Promise<void> {
  const entries = manifest.entries.filter(entry => entry.name !== name)
  if (entries.length === 0) {
    await rm(join(root, manifest.id), { recursive: true, force: true })
    return
  }
  await writeManifest({ ...manifest, manifestPath, entries })
}

export async function clearTrash(root: string): Promise<TrashClearResult> {
  const before = await listTrash(root)
  let removed = 0
  let freedBytes = 0
  for (const item of before.items) {
    await rm(item.trashPath, { recursive: true, force: true }).catch(() => {})
    removed += 1
    freedBytes += item.sizeBytes
  }
  for (const dir of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (dir.isDirectory()) await rm(join(root, dir.name), { recursive: true, force: true }).catch(() => {})
  }
  return { removed, freedBytes }
}

/** 先按 30 天过期，再按最大字节数从最旧条目开始删除。 */
export async function cleanupTrash(root: string, settings: SkillManagerSettings = DEFAULT_SKILL_MANAGER_SETTINGS): Promise<TrashClearResult> {
  const current = await listTrash(root, settings)
  let removed = 0
  let freedBytes = 0
  const keep = new Set<string>()
  for (const item of current.items) {
    if (item.ageDays > settings.trashRetentionDays) {
      await rm(item.trashPath, { recursive: true, force: true }).catch(() => {})
      removed += 1
      freedBytes += item.sizeBytes
    }
    else {
      keep.add(`${item.operationId}:${item.name}`)
    }
  }
  let remaining = current.totalBytes - freedBytes
  const oldestFirst = [...current.items]
    .filter(item => keep.has(`${item.operationId}:${item.name}`))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const item of oldestFirst) {
    if (remaining <= settings.trashMaxBytes) break
    await rm(item.trashPath, { recursive: true, force: true }).catch(() => {})
    removed += 1
    freedBytes += item.sizeBytes
    remaining -= item.sizeBytes
  }
  // 清掉已空的 manifest 目录。
  for (const dir of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!dir.isDirectory()) continue
    const manifest = await readManifest(join(root, dir.name, 'manifest.json'))
    if (!manifest) continue
    const alive: ManifestEntry[] = []
    for (const entry of manifest.entries) {
      if (await exists(entry.trashPath)) alive.push(entry)
    }
    if (alive.length === 0) {
      await rm(join(root, dir.name), { recursive: true, force: true }).catch(() => {})
    }
    else if (alive.length !== manifest.entries.length) {
      await writeManifest({ ...manifest, manifestPath: join(root, dir.name, 'manifest.json'), entries: alive })
    }
  }
  return { removed, freedBytes }
}

export { safePart }
