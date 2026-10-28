import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveLayerPath } from '../../../../backend/utils/data-layers.ts'
import { WB2API_TOOL_ID } from '../../../../shared/workbuddy2api-panel.ts'

/**
 * 配置层根：manifest / 面板设置 / 上游 run 目录（cwd、api_key、auths、上游自己的 data）。
 * 这些不可再生，必须进备份；「打开数据目录」打开的就是这里。
 */
export function getWb2apiRootDir(): string {
  return resolveLayerPath('config', WB2API_TOOL_ID)
}

/** 缓存层根：下载的二进制与 runtime（current / previous / staging），删掉可重新下载 */
export function getWb2apiCacheRootDir(): string {
  return resolveLayerPath('cache', WB2API_TOOL_ID)
}

export function getWb2apiManifestPath(): string {
  return path.join(getWb2apiRootDir(), 'manifest.json')
}

export function getWb2apiSettingsPath(): string {
  return path.join(getWb2apiRootDir(), 'app-settings.json')
}

export function getWb2apiDownloadsDir(): string {
  return path.join(getWb2apiCacheRootDir(), 'downloads')
}

export function getWb2apiRuntimeDir(): string {
  return path.join(getWb2apiCacheRootDir(), 'runtime')
}

export function getWb2apiCurrentDir(): string {
  return path.join(getWb2apiRuntimeDir(), 'current')
}

export function getWb2apiPreviousDir(): string {
  return path.join(getWb2apiRuntimeDir(), 'previous')
}

export function getWb2apiStagingDir(): string {
  return path.join(getWb2apiRuntimeDir(), 'staging')
}

export function getWb2apiRunDir(): string {
  return path.join(getWb2apiRootDir(), 'run')
}

export function getWb2apiConfigPath(): string {
  return path.join(getWb2apiRunDir(), 'config.json')
}

export async function ensureWb2apiDirs(): Promise<void> {
  await Promise.all([
    mkdir(getWb2apiDownloadsDir(), { recursive: true }),
    mkdir(getWb2apiCurrentDir(), { recursive: true }),
    mkdir(getWb2apiPreviousDir(), { recursive: true }),
    mkdir(getWb2apiStagingDir(), { recursive: true }),
    mkdir(path.join(getWb2apiRunDir(), 'auths'), { recursive: true }),
    mkdir(path.join(getWb2apiRunDir(), 'data'), { recursive: true }),
  ])
}
