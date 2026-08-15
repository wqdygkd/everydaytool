import type { Fingerprint } from '../../../../shared/types.js'
import path from 'node:path'
import { copyPath, ensureDir, linkOrCopyTree, pathExists, writeJson } from '../utils/file-ops.js'
import { logger } from '../utils/logger.js'
import { getExtensionTemplatePath, getSharedFingerprintExtPath } from '../utils/path-helper.js'

const CONFIG_FILE = 'fingerprint-config.json'

export async function updateFingerprintConfig(targetPath: string, fingerprint: Fingerprint): Promise<void> {
  await ensureDir(targetPath)
  const configPath = path.join(targetPath, CONFIG_FILE)
  await writeJson(configPath, fingerprint)
}

async function ensureSharedFingerprintExtension(): Promise<string> {
  const sharedPath = getSharedFingerprintExtPath()
  const manifestPath = path.join(sharedPath, 'manifest.json')

  if (await pathExists(manifestPath)) {
    return sharedPath
  }

  const templatePath = getExtensionTemplatePath()
  await copyPath(templatePath, sharedPath, { filter: (src: string) => path.basename(src) !== CONFIG_FILE })
  logger.info('Shared fingerprint extension initialized', { sharedPath })
  return sharedPath
}

async function materializeFingerprintExtension(targetPath: string, sharedPath: string): Promise<void> {
  await ensureDir(targetPath)
  await linkOrCopyTree(sharedPath, targetPath)
}

export async function prepareFingerprintExtension(targetPath: string, fingerprint: Fingerprint): Promise<string> {
  const sharedPath = await ensureSharedFingerprintExtension()
  await materializeFingerprintExtension(targetPath, sharedPath)
  await updateFingerprintConfig(targetPath, fingerprint)
  return targetPath
}
