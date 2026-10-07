// Chrome 安装路径与沙箱 profile 路径（chrome-sandbox 工具域专属）。
// edt 应用数据根目录来自平台基建 backend/utils/data-root.ts。
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { APP_ROOT_DEV, getDataDirectory, isDev } from '../../../../backend/utils/data-root.ts'

interface ChromePaths {
  userDataRoot: string
  defaultProfile: string
  executables: string[]
}

function getChromePaths(): ChromePaths {
  const home = os.homedir()
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    const userDataRoot = path.join(localAppData, 'Google', 'Chrome', 'User Data')
    return {
      userDataRoot,
      defaultProfile: path.join(userDataRoot, 'Default'),
      executables: [
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ],
    }
  }
  if (process.platform === 'darwin') {
    const userDataRoot = path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')
    return {
      userDataRoot,
      defaultProfile: path.join(userDataRoot, 'Default'),
      executables: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    }
  }
  const userDataRoot = path.join(home, '.config', 'google-chrome')
  return {
    userDataRoot,
    defaultProfile: path.join(userDataRoot, 'Default'),
    executables: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }
}

export function getExtensionTemplatePath(): string {
  // In dev: source directory
  // In prod: extraResources copied to resources/extension/
  return isDev
    ? path.join(APP_ROOT_DEV, 'tools', 'chrome-sandbox', 'extension')
    : path.join(process.resourcesPath, 'extension')
}

/** 系统 Chrome 默认 Profile 目录，仅作新建/修复沙箱时的克隆源 */
export function getDefaultChromeProfilePath(): string {
  return getChromePaths().defaultProfile
}

/** 系统 Chrome User Data 根目录，仅作克隆 Local State 等，不作为沙箱 user-data-dir */
export function getChromeUserDataRoot(): string {
  return getChromePaths().userDataRoot
}

export function getDefaultChromePaths(): string[] {
  return getChromePaths().executables
}

/** 所有沙箱 profile 的根目录：删除等写操作必须局限在此目录内 */
export function getSandboxesDirectory(): string {
  return path.join(getDataDirectory(), 'sandboxes')
}

export function getSandboxPath(sandboxId: string): string {
  return path.join(getSandboxesDirectory(), sandboxId)
}

export function getSandboxProfileDirectoryName(sandboxId: string): string {
  return sandboxId.replace(/^sandbox_/, 'sb_')
}

export function getSandboxProfilePath(sandboxId: string): string {
  return path.join(getSandboxPath(sandboxId), getSandboxProfileDirectoryName(sandboxId))
}

export function getSandboxFingerprintExtPath(sandboxId: string): string {
  return path.join(getSandboxPath(sandboxId), 'fingerprint_ext')
}

export function getSharedFingerprintExtPath(): string {
  return path.join(getDataDirectory(), 'shared', 'fingerprint_ext')
}
