import fs from 'fs-extra';
import path from 'path';
import { getExtensionTemplatePath, getSharedFingerprintExtPath } from '../utils/path-helper.js';
import { ensureDir, linkOrCopyTree } from '../utils/file-ops.js';
import { logger } from '../utils/logger.js';
import type { Fingerprint } from '../../../../shared/types.js';

const CONFIG_FILE = 'fingerprint-config.json';

export async function updateFingerprintConfig(targetPath: string, fingerprint: Fingerprint): Promise<void> {
  await ensureDir(targetPath);
  const configPath = path.join(targetPath, CONFIG_FILE);
  await fs.writeJson(configPath, fingerprint, { spaces: 2 });
}

async function ensureSharedFingerprintExtension(): Promise<string> {
  const sharedPath = getSharedFingerprintExtPath();
  const manifestPath = path.join(sharedPath, 'manifest.json');

  if (await fs.pathExists(manifestPath)) {
    return sharedPath;
  }

  const templatePath = getExtensionTemplatePath();
  await fs.copy(templatePath, sharedPath, {
    overwrite: true,
    filter: (src: string) => path.basename(src) !== CONFIG_FILE,
  });
  logger.info('Shared fingerprint extension initialized', { sharedPath });
  return sharedPath;
}

async function materializeFingerprintExtension(targetPath: string, sharedPath: string): Promise<void> {
  await ensureDir(targetPath);
  await linkOrCopyTree(sharedPath, targetPath);
}

export async function prepareFingerprintExtension(targetPath: string, fingerprint: Fingerprint): Promise<string> {
  const sharedPath = await ensureSharedFingerprintExtension();
  await materializeFingerprintExtension(targetPath, sharedPath);
  await updateFingerprintConfig(targetPath, fingerprint);
  return targetPath;
}
