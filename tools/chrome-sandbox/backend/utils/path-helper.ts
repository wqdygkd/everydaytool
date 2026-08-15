import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import os from 'os';
import fs from 'fs-extra';
import { logger } from './logger.js';

const require = createRequire(import.meta.url);
const { app } = require('electron') as typeof import('electron');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use app.isPackaged for reliable detection (NODE_ENV may not be set in packaged apps)
const isDev = !app.isPackaged;

// In development: source files live under tools/, compiled files under dist-backend/tools/.
const sourceRootCandidate = path.resolve(__dirname, '..', '..', '..', '..');
const APP_ROOT_DEV = path.basename(sourceRootCandidate) === 'dist-backend'
  ? path.dirname(sourceRootCandidate)
  : sourceRootCandidate;

interface ChromePaths {
  userDataRoot: string;
  defaultProfile: string;
  executables: string[];
}

function getChromePaths(): ChromePaths {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const userDataRoot = path.join(localAppData, 'Google', 'Chrome', 'User Data');
    return {
      userDataRoot,
      defaultProfile: path.join(userDataRoot, 'Default'),
      executables: [
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ],
    };
  }
  if (process.platform === 'darwin') {
    const userDataRoot = path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
    return {
      userDataRoot,
      defaultProfile: path.join(userDataRoot, 'Default'),
      executables: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    };
  }
  const userDataRoot = path.join(home, '.config', 'google-chrome');
  return {
    userDataRoot,
    defaultProfile: path.join(userDataRoot, 'Default'),
    executables: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  };
}

export function getAppRoot(): string {
  return isDev ? APP_ROOT_DEV : app.getAppPath();
}

export function getDefaultDataDirectory(): string {
  return isDev
    ? path.join(APP_ROOT_DEV, 'data')
    : path.join(app.getPath('userData'), 'data');
}

let dataDirectoryOverride: string | null = null;

function getUserDataFile(filename: string): string {
  return path.join(app.getPath('userData'), filename);
}

export function getBootstrapConfigPath(): string {
  return getUserDataFile('data-root.json');
}

export function getSetupStatePath(): string {
  return getUserDataFile('setup-state.json');
}

export function getCustomDataPathFile(): string {
  return getUserDataFile('data-root.path');
}

async function updateCustomDataPathFile(customDirectory: string | null): Promise<void> {
  const pathFile = getCustomDataPathFile();
  if (!customDirectory) {
    if (await fs.pathExists(pathFile)) {
      await fs.remove(pathFile);
    }
    return;
  }

  if (await fs.pathExists(pathFile)) {
    const existing = (await fs.readFile(pathFile, 'utf8')).trim();
    if (existing === customDirectory) return;
  }

  await fs.writeFile(pathFile, customDirectory, 'utf8');
}

export async function isDataDirectoryConfigured(): Promise<boolean> {
  const setupPath = getSetupStatePath();
  if (await fs.pathExists(setupPath)) {
    try {
      const state = await fs.readJson(setupPath);
      return state.dataDirectoryConfigured === true;
    } catch (error) {
      logger.warn('Failed to read setup state', { error: (error as Error).message });
    }
  }

  return fs.pathExists(getBootstrapConfigPath());
}

export async function markDataDirectoryConfigured(): Promise<void> {
  const setupPath = getSetupStatePath();
  await fs.ensureDir(path.dirname(setupPath));
  await fs.writeJson(setupPath, { dataDirectoryConfigured: true }, { spaces: 2 });
}

export function setDataDirectoryOverride(dir: string | null): void {
  dataDirectoryOverride = normalizeDataDirectory(dir);
}

export function isSameDataDirectory(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

export async function applyDataDirectoryChange(
  nextDirectory: string,
): Promise<{ dataDirectory: string; changed: boolean }> {
  const normalized = normalizeDataDirectory(nextDirectory) || getDefaultDataDirectory();
  await fs.ensureDir(normalized);

  const changed = !isSameDataDirectory(normalized, getDataDirectory());
  if (!changed) {
    return { dataDirectory: normalized, changed: false };
  }

  const bootstrapTarget = isSameDataDirectory(normalized, getDefaultDataDirectory()) ? null : normalized;
  await saveDataDirectoryOverride(bootstrapTarget);
  setDataDirectoryOverride(bootstrapTarget);

  return { dataDirectory: normalized, changed: true };
}

export function normalizeDataDirectory(dir: string | null | undefined): string | null {
  if (!dir || !String(dir).trim()) return null;
  return path.resolve(String(dir).trim());
}

export function getDataDirectory(): string {
  return dataDirectoryOverride || getDefaultDataDirectory();
}

export async function syncCustomDataPathFile(): Promise<void> {
  await updateCustomDataPathFile(dataDirectoryOverride);
}

export async function loadDataDirectoryOverride(): Promise<void> {
  const bootstrapPath = getBootstrapConfigPath();
  try {
    if (!await fs.pathExists(bootstrapPath)) return;
    const { dataDirectory } = await fs.readJson(bootstrapPath);
    setDataDirectoryOverride(normalizeDataDirectory(dataDirectory));
  } catch (error) {
    logger.warn('Failed to load data directory override', { error: (error as Error).message });
  } finally {
    await syncCustomDataPathFile();
  }
}

export async function saveDataDirectoryOverride(dataDirectory: string | null): Promise<void> {
  const bootstrapPath = getBootstrapConfigPath();
  await fs.ensureDir(path.dirname(bootstrapPath));

  if (!dataDirectory) {
    await fs.remove(bootstrapPath);
    await updateCustomDataPathFile(null);
    return;
  }

  await fs.writeJson(bootstrapPath, { dataDirectory }, { spaces: 2 });
  await updateCustomDataPathFile(dataDirectory);
}

export function getSandboxesDirectory(): string {
  return path.join(getDataDirectory(), 'sandboxes');
}

export function getDatabasePath(): string {
  return path.join(getDataDirectory(), 'config.db');
}

export function getExtensionTemplatePath(): string {
  // In dev: source directory
  // In prod: extraResources copied to resources/extension/
  return isDev
    ? path.join(APP_ROOT_DEV, 'tools', 'chrome-sandbox', 'extension')
    : path.join(process.resourcesPath, 'extension');
}

/** 系统 Chrome 默认 Profile 目录，仅作新建/修复沙箱时的克隆源 */
export function getDefaultChromeProfilePath(): string {
  return getChromePaths().defaultProfile;
}

/** 系统 Chrome User Data 根目录，仅作克隆 Local State 等，不作为沙箱 user-data-dir */
export function getChromeUserDataRoot(): string {
  return getChromePaths().userDataRoot;
}

export function getDefaultChromePaths(): string[] {
  return getChromePaths().executables;
}

export function getSandboxPath(sandboxId: string): string {
  return path.join(getSandboxesDirectory(), sandboxId);
}

export function getSandboxProfileDirectoryName(sandboxId: string): string {
  return sandboxId.replace(/^sandbox_/, 'sb_');
}

export function getSandboxProfilePath(sandboxId: string): string {
  return path.join(getSandboxPath(sandboxId), getSandboxProfileDirectoryName(sandboxId));
}

export function getSandboxFingerprintExtPath(sandboxId: string): string {
  return path.join(getSandboxPath(sandboxId), 'fingerprint_ext');
}

export function getSharedFingerprintExtPath(): string {
  return path.join(getDataDirectory(), 'shared', 'fingerprint_ext');
}
