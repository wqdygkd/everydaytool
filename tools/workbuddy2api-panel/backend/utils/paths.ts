import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { getDataDirectory } from '../../../../backend/utils/data-root.ts'
import { WB2API_TOOL_ID } from '../../../../shared/workbuddy2api-panel.ts'

export function getWb2apiRootDir(): string {
  return path.join(getDataDirectory(), WB2API_TOOL_ID)
}

export function getWb2apiManifestPath(): string {
  return path.join(getWb2apiRootDir(), 'manifest.json')
}

export function getWb2apiSettingsPath(): string {
  return path.join(getWb2apiRootDir(), 'app-settings.json')
}

export function getWb2apiDownloadsDir(): string {
  return path.join(getWb2apiRootDir(), 'downloads')
}

export function getWb2apiRuntimeDir(): string {
  return path.join(getWb2apiRootDir(), 'runtime')
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
