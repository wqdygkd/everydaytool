import type {
  BackupAssetRecord,
  BackupEntryRecord,
  BackupExportOptions,
  BackupExportResult,
  BackupFileRecord,
  BackupInspectResult,
  BackupManifest,
  BackupRestoreReport,
} from '../../shared/backup.ts'
// 备份与恢复（配置 / 资产清单 / 可选会话）——业务层，容器编解码见 backup-format.ts。
//
// 规则（docs/data-layers.md §8）：
// - **缓存层永不进入备份**；配置层默认必含；资产层**只出清单**（内容不打包：GB~TB 级且恢复不写 assets）；
//   会话层可选出（默认不含）；
// - 导出前把敏感条目（账号密码 / CA 私钥 / token / api_key）逐项列给用户，可跳过或加口令；
// - 恢复只写 config（与可选 session）层，**永不写 cache 层**；恢复前先把现有配置层快照到
//   `<data>/cache/import-rollback/<ts>/`（缓存层天然可清，等于免费的回滚点）；
// - 恢复后必须 `invalidateJsonDocuments()`——运行期替换了磁盘文件，进程内缓存必须丢。
import type { DataLayer } from '../../shared/data-layers.ts'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { app } from 'electron'
import { BACKUP_FORMAT_VERSION } from '../../shared/backup.ts'
import { CHROMIUM_SESSION_CACHE_DIRS, DATA_LAYER_ENTRIES, joinLayerPath } from '../../shared/data-layers.ts'
import { getAssetsRoot } from './assets-root.ts'
import { decodeBackupArchive, encodeBackupArchive, readBackupHeader } from './backup-format.ts'
import { getLayerRoot, resolveLayerPathWithFallback } from './data-layers.ts'
import { invalidateJsonDocuments } from './json-store.ts'
import { logger } from './logger.ts'

const MAX_WALK_DEPTH = 16
const IMPORT_ROLLBACK_DIR = 'import-rollback'

/** 会话层里不该进备份的目录（Chromium 可再生缓存，清单与清缓存共用 shared 里的那一份） */
const SESSION_CACHE_DIR_NAMES = new Set<string>(CHROMIUM_SESSION_CACHE_DIRS)

interface CollectedFile {
  /** 相对层根 */
  relativePath: string
  layer: DataLayer
  absolutePath: string
  size: number
}

function sha256Of(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

async function walkFiles(root: string, onFile: (absolutePath: string) => void, depth = 0): Promise<void> {
  if (depth > MAX_WALK_DEPTH) return
  let dirents: import('node:fs').Dirent[]
  try {
    dirents = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) continue
    const absolutePath = path.join(root, dirent.name)
    if (dirent.isDirectory()) {
      await walkFiles(absolutePath, onFile, depth + 1)
    } else if (dirent.isFile()) {
      onFile(absolutePath)
    }
  }
}

/**
 * 收集一个条目的文件。相对路径由「条目自己的 relativePath + 目录内相对路径」拼出，
 * 不需要再从绝对路径反推层根（那会在每个文件上都重排一次层根列表）。
 * 读取带回查 v1 旧位置：迁移失败的条目还躺在平铺目录里，漏掉它等于备份里悄悄少一份配置。
 */
async function collectEntryFiles(entryId: string): Promise<CollectedFile[]> {
  const entry = DATA_LAYER_ENTRIES.find(item => item.id === entryId)
  if (!entry) return []

  const absolute = entry.relativePath === '.'
    ? getLayerRoot(entry.layer)
    : resolveLayerPathWithFallback(entry.layer, entry.relativePath)

  try {
    const info = await stat(absolute)
    if (info.isFile()) {
      return [{ relativePath: entry.relativePath, layer: entry.layer, absolutePath: absolute, size: info.size }]
    }
    if (!info.isDirectory()) return []
  } catch {
    return []
  }

  const files: CollectedFile[] = []
  await walkFiles(absolute, (absolutePath) => {
    const inner = path.relative(absolute, absolutePath).split(path.sep).join('/')
    files.push({
      relativePath: entry.relativePath === '.' ? inner : `${entry.relativePath}/${inner}`,
      layer: entry.layer,
      absolutePath,
      size: 0,
    })
  })
  for (const file of files) {
    try {
      file.size = (await stat(file.absolutePath)).size
    } catch {
      file.size = 0
    }
  }
  return files
}

/** 收集备份条目：配置层按清单逐条，会话层按需整层（跳过 Chromium 缓存目录） */
async function collectBackupFiles(options: BackupExportOptions): Promise<{
  files: CollectedFile[]
  omittedSensitive: string[]
  includedEntries: string[]
}> {
  const files: CollectedFile[] = []
  const omittedSensitive: string[] = []
  const includedEntries: string[] = []

  for (const entry of DATA_LAYER_ENTRIES) {
    if (entry.layer !== 'config') continue
    if (entry.backup === 'never') continue
    if (entry.sensitive && options.skipSensitive) {
      omittedSensitive.push(entry.id)
      continue
    }
    const entryFiles = await collectEntryFiles(entry.id)
    if (entryFiles.length === 0) continue
    files.push(...entryFiles)
    includedEntries.push(entry.id)
  }

  if (options.includeSession) {
    const sessionRoot = getLayerRoot('session')
    const collected: CollectedFile[] = []
    await walkFiles(sessionRoot, (absolutePath) => {
      const relativePath = path.relative(sessionRoot, absolutePath).split(path.sep).join('/')
      // 跳过可再生能源的 Chromium 缓存目录（登录态本身要留）
      if (relativePath.split('/').some(segment => SESSION_CACHE_DIR_NAMES.has(segment))) return
      collected.push({ relativePath, layer: 'session', absolutePath, size: 0 })
    })
    for (const file of collected) {
      try {
        file.size = (await stat(file.absolutePath)).size
      } catch {
        file.size = 0
      }
    }
    if (collected.length > 0) {
      files.push(...collected)
      includedEntries.push('session.chromium')
    }
  }

  return { files, omittedSensitive, includedEntries }
}

/** 资产清单：只记录路径与体积，不逐文件哈希（TB 级会拖到分钟以上） */
async function collectAssetManifest(): Promise<BackupAssetRecord[]> {
  const assetsRoot = getAssetsRoot()
  const records: BackupAssetRecord[] = []
  const walk = async (root: string, depth = 0): Promise<void> => {
    if (depth > MAX_WALK_DEPTH) return
    let dirents: import('node:fs').Dirent[]
    try {
      dirents = await readdir(root, { withFileTypes: true })
    } catch {
      return
    }
    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue
      const absolutePath = path.join(root, dirent.name)
      if (dirent.isDirectory()) {
        await walk(absolutePath, depth + 1)
        continue
      }
      if (!dirent.isFile()) continue
      let size = 0
      try {
        size = (await stat(absolutePath)).size
      } catch {
        size = 0
      }
      const relativePath = path.relative(assetsRoot, absolutePath).split(path.sep).join('/')
      records.push({ relativePath, size, toolId: relativePath.split('/')[0] ?? '' })
    }
  }
  await walk(assetsRoot)
  return records
}

/** 导出备份包到指定路径 */
export async function createBackup(destinationPath: string, options: BackupExportOptions = {}): Promise<BackupExportResult> {
  const { files, omittedSensitive, includedEntries } = await collectBackupFiles(options)
  const assetManifest = await collectAssetManifest()

  const archiveFiles: BackupFileRecord[] = []
  const entryRecords: BackupEntryRecord[] = []
  for (const file of files) {
    const data = await readFile(file.absolutePath)
    archiveFiles.push({ name: `${file.layer}/${file.relativePath}`, data })
    const owner = DATA_LAYER_ENTRIES.find(item => item.layer === file.layer
      && (item.relativePath === '.' || file.relativePath === item.relativePath || file.relativePath.startsWith(`${item.relativePath}/`)))
    entryRecords.push({
      id: owner?.id ?? `unknown:${file.layer}`,
      layer: file.layer,
      relativePath: file.relativePath,
      size: data.length,
      sha256: sha256Of(data),
    })
  }

  const manifest: BackupManifest = {
    schemaVersion: BACKUP_FORMAT_VERSION as BackupManifest['schemaVersion'],
    appVersion: app.getVersion(),
    platform: process.platform,
    createdAt: new Date().toISOString(),
    encrypted: Boolean(options.password?.trim()),
    strategy: {
      config: true,
      session: Boolean(options.includeSession),
      // 资产只出清单：内容动辄 GB~TB 级，进包既打不出也恢复不了（恢复只写 config / session）
      assets: 'manifest',
      cache: false,
    },
    entries: entryRecords,
    assets: assetManifest,
    omittedSensitive,
    totals: {
      files: entryRecords.length,
      bytes: entryRecords.reduce((sum, item) => sum + item.size, 0),
      assetFiles: assetManifest.length,
      assetBytes: assetManifest.reduce((sum, item) => sum + item.size, 0),
    },
  }

  const archive = encodeBackupArchive({ manifest, files: archiveFiles }, { password: options.password })
  await mkdir(path.dirname(destinationPath), { recursive: true })
  await writeFile(destinationPath, archive)
  logger.info('Backup created', {
    savedPath: destinationPath,
    entries: entryRecords.length,
    bytes: archive.length,
    encrypted: manifest.encrypted,
    omittedSensitive: omittedSensitive.length,
  })
  return {
    savedPath: destinationPath,
    bytes: archive.length,
    encrypted: manifest.encrypted,
    includedEntries,
    omittedSensitive,
    assetFiles: assetManifest.length,
  }
}

/** 校验包内每个文件的 sha256（清单里 sha256 为 null 的跳过） */
function verifyChecksums(manifest: BackupManifest, files: BackupFileRecord[]): boolean {
  const byName = new Map(files.map(file => [file.name, file]))
  for (const entry of manifest.entries) {
    if (!entry.sha256) continue
    const file = byName.get(`${entry.layer}/${entry.relativePath}`)
    if (!file) return false
    if (sha256Of(Buffer.from(file.data)) !== entry.sha256) return false
  }
  return true
}

/** 预检：只读头部 + 逐文件校验，不写盘 */
export async function inspectBackup(filePath: string, options: { password?: string } = {}): Promise<BackupInspectResult> {
  const buffer = await readFile(filePath)
  const header = readBackupHeader(buffer)
  if (header.encrypted && !options.password?.trim()) {
    return { filePath, encrypted: true, checksumOk: false, manifest: null, needsPassword: true }
  }
  const { manifest, files } = decodeBackupArchive(buffer, { password: options.password })
  return {
    filePath,
    encrypted: header.encrypted,
    checksumOk: verifyChecksums(manifest, files),
    manifest,
    needsPassword: false,
  }
}

interface ConfigSnapshot {
  /** 快照目录（位于缓存层，可随时清掉） */
  dir: string
  /** 快照里包含的文件（相对配置层根）：回滚时据此删掉恢复期间新增的文件 */
  files: string[]
}

/** 递归收集某目录下的全部文件（相对 root 的 posix 路径） */
async function listFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > MAX_WALK_DEPTH) return []
  let dirents: import('node:fs').Dirent[]
  try {
    dirents = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) continue
    const absolutePath = path.join(root, dirent.name)
    if (dirent.isDirectory()) {
      out.push(...await listFiles(absolutePath, depth + 1))
      continue
    }
    if (dirent.isFile()) out.push(path.relative(root, absolutePath).split(path.sep).join('/'))
  }
  return out
}

/** 把现有配置层快照到缓存层（回滚点）；配置层为空时返回 null */
async function snapshotConfigLayer(): Promise<ConfigSnapshot | null> {
  const configRoot = getLayerRoot('config')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(getLayerRoot('cache'), IMPORT_ROLLBACK_DIR, stamp)
  const files = await listFiles(configRoot)
  if (files.length === 0) return null

  for (const relativePath of files) {
    const destination = path.join(target, ...relativePath.split('/'))
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(path.join(configRoot, ...relativePath.split('/')), destination)
  }
  logger.info('Config layer snapshot for rollback created', { target, files: files.length })
  return { dir: target, files }
}

/**
 * 回滚：把配置层还原成快照那一刻的样子。
 * 先删掉恢复期间新增的文件，再用快照逐个覆盖——只覆盖不删会留下半截的「混合配置」。
 */
async function rollbackConfigLayer(snapshot: ConfigSnapshot): Promise<void> {
  const configRoot = getLayerRoot('config')
  const snapshotFiles = new Set(snapshot.files)
  for (const relativePath of await listFiles(configRoot)) {
    if (snapshotFiles.has(relativePath)) continue
    try {
      await rm(path.join(configRoot, ...relativePath.split('/')), { force: true })
    } catch (error) {
      logger.warn('Failed to remove file added during restore', { relativePath, error: (error as Error).message })
    }
  }
  for (const relativePath of snapshot.files) {
    const destination = path.join(configRoot, ...relativePath.split('/'))
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(path.join(snapshot.dir, ...relativePath.split('/')), destination)
  }
  logger.warn('Config layer rolled back after failed restore', { snapshot: snapshot.dir })
}

/** 把包内文件名映射回清单元件 id（恢复报告只报真的写进去了的条目） */
function entryIdOf(layer: DataLayer, relativePath: string): string {
  const owner = DATA_LAYER_ENTRIES.find(item => item.layer === layer
    && (item.relativePath === '.' || relativePath === item.relativePath || relativePath.startsWith(`${item.relativePath}/`)))
  return owner?.id ?? `unknown:${layer}`
}

/**
 * 从备份包恢复：只写 config（与可选 session）层。
 * 覆盖前先把现有配置层快照到 `cache/import-rollback/<ts>/`（回滚点），
 * 写入中途失败则**原地回滚**并报告快照位置——不留半截文件。
 */
export async function restoreBackup(
  filePath: string,
  options: { password?: string, includeSession?: boolean } = {},
): Promise<BackupRestoreReport> {
  const buffer = await readFile(filePath)
  const { manifest, files } = decodeBackupArchive(buffer, { password: options.password })
  const warnings: string[] = []
  const restoredEntries: string[] = []
  const skippedEntries: string[] = []
  /** 本次真正写过的绝对路径：没有快照可回滚时，靠它把半截结果撤掉 */
  const writtenTargets: string[] = []
  let touchedSession = false

  if (!verifyChecksums(manifest, files)) {
    throw new Error('备份包校验失败（文件内容与清单的 sha256 不一致），已中止恢复')
  }

  const snapshot = await snapshotConfigLayer()

  try {
    for (const file of files) {
      const [layerSegment, ...rest] = file.name.split('/')
      const layer = layerSegment as DataLayer
      if (layer !== 'config' && layer !== 'session') {
        // 资产内容 / 缓存：备份包里不该有，出现了也只跳过，绝不写盘
        skippedEntries.push(file.name)
        warnings.push(`已跳过不支持的条目：${file.name}`)
        continue
      }
      if (layer === 'session' && !options.includeSession) {
        skippedEntries.push(file.name)
        warnings.push('备份包含会话层，但本次未勾选恢复（登录态维持现状）')
        continue
      }
      let relativePath: string
      try {
        relativePath = joinLayerPath(...rest)
      } catch {
        skippedEntries.push(file.name)
        warnings.push(`已跳过非法路径：${file.name}`)
        continue
      }
      const target = path.join(getLayerRoot(layer), ...relativePath.split('/'))
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, Buffer.from(file.data))
      writtenTargets.push(target)
      if (layer === 'session') touchedSession = true
      const entryId = entryIdOf(layer, relativePath)
      if (!restoredEntries.includes(entryId)) restoredEntries.push(entryId)
    }
  } catch (error) {
    // 中途失败：回滚到快照，绝不留在「一半新一半旧」的配置层上
    if (snapshot) {
      try {
        await rollbackConfigLayer(snapshot)
      } catch (rollbackError) {
        logger.error('Rollback after failed restore also failed', {
          snapshot: snapshot.dir,
          error: (rollbackError as Error).message,
        })
        throw new Error(`恢复失败（${(error as Error).message}），且自动回滚失败；`
          + `配置层快照在 ${snapshot.dir}，请手工还原`)
      }
      throw new Error(`恢复失败：${(error as Error).message}；已回滚到恢复前的配置层（快照 ${snapshot.dir}）`)
    }
    // 恢复前配置层是空的，没有快照可覆盖：把本次写过的文件删掉即可回到「空」
    for (const target of writtenTargets.reverse()) {
      try {
        await rm(target, { force: true })
      } catch (removeError) {
        logger.warn('Failed to remove partially restored file', {
          target,
          error: (removeError as Error).message,
        })
      }
    }
    throw new Error(`恢复失败：${(error as Error).message}；恢复前配置层为空，已删除本次写过的 `
      + `${writtenTargets.length} 个文件`)
  }

  // 运行期替换了磁盘文件：进程内 JSON 缓存必须丢，否则读到旧内容
  invalidateJsonDocuments()

  // 资产清单对账（内容不在包里）：只报告缺失，不写盘
  const missingAssets: string[] = []
  for (const asset of manifest.assets) {
    const absolute = path.join(getAssetsRoot(), ...joinLayerPath(asset.relativePath).split('/'))
    try {
      const info = await stat(absolute)
      if (info.size !== asset.size) missingAssets.push(asset.relativePath)
    } catch {
      missingAssets.push(asset.relativePath)
    }
  }

  logger.info('Backup restored', {
    filePath,
    restored: restoredEntries.length,
    skipped: skippedEntries.length,
    missingAssets: missingAssets.length,
    touchedSession,
  })

  if (touchedSession) warnings.push('已写入会话层（Cookies / LocalStorage）：需重启应用后 Chromium 才会使用新数据')

  return {
    filePath,
    restoredEntries,
    skippedEntries,
    rollbackSnapshot: snapshot?.dir ?? null,
    missingAssets,
    touchedSession,
    warnings,
  }
}
