import type {
  Wb2apiInstallSource,
  Wb2apiManifest,
  Wb2apiProgressEvent,
  Wb2apiUpdateInfo,
} from '../../../../shared/workbuddy2api-panel.ts'
import { copyFile, cp, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { dialog } from 'electron'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import {
  buildWb2apiAssetName,
  WB2API_GITHUB_REPO_SLUG,
  wb2apiTagFromVersion,
  wb2apiVersionFromTag,
} from '../../../../shared/workbuddy2api-panel.ts'
import { WB2API_PANEL_IPC_CHANNELS } from '../ipc/channels.ts'
import { readManifest, writeManifest } from '../store/manifest-store.ts'
import { assertFileDigest, normalizeDigest, sha256FileDigest } from '../utils/digest.ts'
import { downloadToFile, fetchGithubJson } from '../utils/http.ts'
import {
  ensureWb2apiDirs,
  getWb2apiCurrentDir,
  getWb2apiDownloadsDir,
  getWb2apiPreviousDir,
  getWb2apiStagingDir,
} from '../utils/paths.ts'
import { resolveWb2apiPlatform, wb2apiBinaryFileName } from '../utils/platform.ts'
import { extractZipArchive, findBinaryInDir } from '../utils/zip.ts'
import {
  isInstallBusy,
  setActiveAbort,
  setInstallBusy,
} from './busy-flag.ts'
import { ensureRunConfigInitialized } from './config-service.ts'
import { probeHealthz } from './health-service.ts'
import { prepareBinaryPermissions, resolveCurrentBinaryPath, startManagedProcess, stopManagedProcess } from './process-service.ts'
import { publishStateSoon, setLastProgress } from './state-service.ts'

interface GithubReleaseAsset {
  name: string
  browser_download_url: string
  digest?: string
}

interface GithubRelease {
  tag_name: string
  assets: GithubReleaseAsset[]
}

function emitProgress(event: Wb2apiProgressEvent): void {
  setLastProgress(event)
  broadcastToWindows(WB2API_PANEL_IPC_CHANNELS.EVENT_PROGRESS, event, {
    onError: error => logger.warn('wb2api progress broadcast failed', { error: error.message }),
  })
  publishStateSoon()
}

async function promoteStagingToCurrent(): Promise<string> {
  const staging = getWb2apiStagingDir()
  const current = getWb2apiCurrentDir()
  const previous = getWb2apiPreviousDir()
  const binaryName = wb2apiBinaryFileName()

  const binaryInStaging = await findBinaryInDir(staging, binaryName)
  if (!binaryInStaging) {
    throw new Error(`解压后未找到 ${binaryName}`)
  }

  // 扁平化：把二进制与同级 example 提到 staging 根（若在子目录）
  const stagingRootBinary = path.join(staging, binaryName)
  if (path.resolve(binaryInStaging) !== path.resolve(stagingRootBinary)) {
    await copyFile(binaryInStaging, stagingRootBinary)
    const exampleSrc = path.join(path.dirname(binaryInStaging), 'config.example.json')
    const exampleDest = path.join(staging, 'config.example.json')
    try {
      await copyFile(exampleSrc, exampleDest)
    } catch {
      // optional
    }
  }

  await prepareBinaryPermissions(stagingRootBinary)

  await rm(previous, { recursive: true, force: true })
  try {
    await rename(current, previous)
  } catch {
    // current 可能为空
    await rm(current, { recursive: true, force: true })
  }
  await mkdir(path.dirname(current), { recursive: true })
  await rename(staging, current)
  await mkdir(staging, { recursive: true })

  const finalBinary = await resolveCurrentBinaryPath()
  if (!finalBinary) throw new Error('晋升 current 后找不到二进制')
  return finalBinary
}

async function rollbackPrevious(): Promise<void> {
  const current = getWb2apiCurrentDir()
  const previous = getWb2apiPreviousDir()
  const staging = getWb2apiStagingDir()
  emitProgress({ phase: 'rollback', downloadedBytes: 0, totalBytes: 0, message: '更新失败，回滚 previous' })
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  // current ↔ previous 交换
  const tmp = `${current}.rollback-tmp`
  await rm(tmp, { recursive: true, force: true })
  try {
    await rename(current, tmp)
  } catch {
    await rm(current, { recursive: true, force: true })
  }
  try {
    await rename(previous, current)
  } catch {
    // previous 不存在则尽力恢复 tmp
    try {
      await rename(tmp, current)
    } catch {
      // ignore
    }
    throw new Error('回滚失败：无 previous 版本')
  }
  await rm(previous, { recursive: true, force: true })
  try {
    await rename(tmp, previous)
  } catch {
    await rm(tmp, { recursive: true, force: true })
  }
}

async function installFromZipFile(
  zipPath: string,
  meta: {
    version: string
    tag: string
    assetName: string
    digest: string
    source: Wb2apiInstallSource
  },
): Promise<Wb2apiManifest> {
  const { os, arch } = resolveWb2apiPlatform()
  emitProgress({ phase: 'verify', downloadedBytes: 0, totalBytes: 0, message: '校验 digest' })
  await assertFileDigest(zipPath, meta.digest)

  emitProgress({ phase: 'extract', downloadedBytes: 0, totalBytes: 0, message: '解压到 staging' })
  await extractZipArchive(zipPath, getWb2apiStagingDir())

  emitProgress({ phase: 'promote', downloadedBytes: 0, totalBytes: 0, message: '晋升为 current' })
  await promoteStagingToCurrent()
  await ensureRunConfigInitialized()

  const manifest: Wb2apiManifest = {
    version: meta.version,
    tag: meta.tag,
    os,
    arch,
    assetName: meta.assetName,
    digest: normalizeDigest(meta.digest) ?? meta.digest,
    source: meta.source,
    installedAt: new Date().toISOString(),
  }
  writeManifest(manifest)
  emitProgress({ phase: 'done', downloadedBytes: 0, totalBytes: 0, message: '安装完成' })
  return manifest
}

interface ReleaseAssetPick {
  release: GithubRelease
  asset: GithubReleaseAsset
  version: string
  tag: string
}

async function pickReleaseAsset(tag?: string): Promise<ReleaseAssetPick> {
  const { os, arch } = resolveWb2apiPlatform()
  const apiUrl = tag
    ? `https://api.github.com/repos/${WB2API_GITHUB_REPO_SLUG}/releases/tags/${encodeURIComponent(tag)}`
    : `https://api.github.com/repos/${WB2API_GITHUB_REPO_SLUG}/releases/latest`
  const release = await fetchGithubJson<GithubRelease>(apiUrl)
  const version = wb2apiVersionFromTag(release.tag_name)
  const assetName = buildWb2apiAssetName(version, os, arch)
  const asset = release.assets.find(a => a.name === assetName)
  if (!asset) {
    throw new Error(`Release ${release.tag_name} 未找到资产 ${assetName}`)
  }
  return { release, asset, version, tag: release.tag_name }
}

export async function installFromGithub(tag?: string): Promise<Wb2apiManifest> {
  if (isInstallBusy()) throw new Error('已有安装/更新任务进行中')
  setInstallBusy(true)
  const controller = new AbortController()
  setActiveAbort(controller)
  try {
    await ensureWb2apiDirs()
    const pick = await pickReleaseAsset(tag)
    const digest = normalizeDigest(pick.asset.digest)
    if (!digest) throw new Error(`资产 ${pick.asset.name} 缺少 GitHub digest，拒绝安装`)

    const dest = path.join(getWb2apiDownloadsDir(), pick.asset.name)
    emitProgress({ phase: 'download', downloadedBytes: 0, totalBytes: 0, message: `下载 ${pick.asset.name}` })
    await downloadToFile(pick.asset.browser_download_url, dest, {
      signal: controller.signal,
      onProgress: (downloaded, total) => {
        emitProgress({
          phase: 'download',
          downloadedBytes: downloaded,
          totalBytes: total,
          message: `下载 ${pick.asset.name}`,
        })
      },
    })

    return await installFromZipFile(dest, {
      version: pick.version,
      tag: pick.tag,
      assetName: pick.asset.name,
      digest,
      source: 'github',
    })
  } catch (error) {
    const cancelled = controller.signal.aborted
    emitProgress({
      phase: cancelled ? 'cancelled' : 'error',
      downloadedBytes: 0,
      totalBytes: 0,
      error: cancelled ? undefined : error instanceof Error ? error.message : String(error),
      message: cancelled ? '已取消' : undefined,
    })
    throw error
  } finally {
    setActiveAbort(null)
    setInstallBusy(false)
  }
}

export async function installFromLocalZip(): Promise<Wb2apiManifest | null> {
  if (isInstallBusy()) throw new Error('已有安装/更新任务进行中')
  const result = await dialog.showOpenDialog({
    title: '选择 workbuddy2api-panel 安装包',
    properties: ['openFile'],
    filters: [
      { name: 'ZIP', extensions: ['zip'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePaths[0]) return null

  setInstallBusy(true)
  try {
    await ensureWb2apiDirs()
    const zipPath = result.filePaths[0]
    const digest = await sha256FileDigest(zipPath)
    const base = path.basename(zipPath)
    // 尽量从文件名解析版本；解析失败则用时间戳版本标记
    const m = base.match(/^wb2api-panel-([0-9.]+)-/)
    const version = m?.[1] ?? `local-${Date.now()}`
    const tag = wb2apiTagFromVersion(version)

    // 复制到 downloads 留存
    const dest = path.join(getWb2apiDownloadsDir(), base)
    await cp(zipPath, dest)

    return await installFromZipFile(dest, {
      version,
      tag,
      assetName: base,
      digest,
      source: 'local-file',
    })
  } catch (error) {
    emitProgress({
      phase: 'error',
      downloadedBytes: 0,
      totalBytes: 0,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    setInstallBusy(false)
  }
}

export async function checkUpdate(): Promise<Wb2apiUpdateInfo> {
  const pick = await pickReleaseAsset()
  const digest = normalizeDigest(pick.asset.digest) ?? ''
  if (!digest) throw new Error(`最新版本资产 ${pick.asset.name} 缺少 digest`)
  const current = readManifest()
  const currentVersion = current?.version ?? null
  return {
    currentVersion,
    latestVersion: pick.version,
    latestTag: pick.tag,
    assetName: pick.asset.name,
    digest,
    downloadUrl: pick.asset.browser_download_url,
    hasUpdate: currentVersion !== pick.version,
  }
}

/**
 * 更新单轨：先 stop → 装新 → 探活命中身份则成功，否则回滚 previous。
 * 不自动常驻；更新后会尝试 start 做探活，探活完若调用方未要求可再 stop——
 * 设计：探活命中即成功，保持运行（用户本就在更新流程中）。
 */
export async function applyUpdate(): Promise<Wb2apiManifest> {
  if (isInstallBusy()) throw new Error('已有安装/更新任务进行中')
  setInstallBusy(true)
  const controller = new AbortController()
  setActiveAbort(controller)
  const previousManifest = readManifest()
  try {
    await ensureWb2apiDirs()
    await stopManagedProcess()

    const pick = await pickReleaseAsset()
    const digest = normalizeDigest(pick.asset.digest)
    if (!digest) throw new Error(`资产 ${pick.asset.name} 缺少 GitHub digest`)

    const dest = path.join(getWb2apiDownloadsDir(), pick.asset.name)
    emitProgress({ phase: 'download', downloadedBytes: 0, totalBytes: 0, message: `下载 ${pick.asset.name}` })
    await downloadToFile(pick.asset.browser_download_url, dest, {
      signal: controller.signal,
      onProgress: (downloaded, total) => {
        emitProgress({
          phase: 'download',
          downloadedBytes: downloaded,
          totalBytes: total,
          message: `下载 ${pick.asset.name}`,
        })
      },
    })

    const manifest = await installFromZipFile(dest, {
      version: pick.version,
      tag: pick.tag,
      assetName: pick.asset.name,
      digest,
      source: 'github',
    })

    // 探活验证
    try {
      const { port } = await startManagedProcess()
      const health = await probeHealthz(port)
      if (!health.ok) {
        throw new Error(health.error || '更新后探活未命中 service=workbuddy2api')
      }
    } catch (error) {
      await stopManagedProcess().catch(() => {})
      await rollbackPrevious()
      if (previousManifest) writeManifest(previousManifest)
      try {
        await startManagedProcess()
      } catch (restartError) {
        logger.warn('rollback restart failed', { error: (restartError as Error).message })
      }
      throw error
    }

    return manifest
  } catch (error) {
    const cancelled = controller.signal.aborted
    emitProgress({
      phase: cancelled ? 'cancelled' : 'error',
      downloadedBytes: 0,
      totalBytes: 0,
      error: cancelled ? undefined : error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    setActiveAbort(null)
    setInstallBusy(false)
  }
}
