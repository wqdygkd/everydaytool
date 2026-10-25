// Chrome 安装路径与沙箱 profile 路径（chrome-sandbox 工具域专属）。
// edt 应用数据根目录来自平台基建 backend/utils/data-root.ts。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { APP_ROOT_DEV, getDataDirectory, isDev } from '../../../../backend/utils/data-root.ts'
import { logger } from '../../../../backend/utils/logger.ts'

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

/** chrome-sandbox 工具的数据目录（沙箱列表 / 指纹 / 工具配置的 JSON 文件都落在其下） */
export function getChromeSandboxDataDirectory(): string {
  return path.join(getDataDirectory(), 'chrome-sandbox')
}

type LayoutRoot = 'tool' | 'legacy'

let sandboxesRoot: LayoutRoot = 'tool'
let sharedRoot: LayoutRoot = 'tool'

/**
 * 把旧的数据根目录布局收进 chrome-sandbox/：
 *   <data>/sandboxes  → <data>/chrome-sandbox/sandboxes
 *   <data>/shared     → <data>/chrome-sandbox/shared
 * 旧目录被 Chrome 占用时 rename 会失败，此时继续用旧布局（不复制、不破坏运行中的 profile）。
 */
export function ensureChromeSandboxLayout(): void {
  const dataDirectory = getDataDirectory()
  const legacySandboxes = path.join(dataDirectory, 'sandboxes')
  const nextSandboxes = path.join(dataDirectory, 'chrome-sandbox', 'sandboxes')
  sandboxesRoot = migrateInto(legacySandboxes, nextSandboxes)
  if (sandboxesRoot === 'tool') rewriteSandboxPaths(legacySandboxes, nextSandboxes)

  sharedRoot = migrateInto(
    path.join(dataDirectory, 'shared'),
    path.join(dataDirectory, 'chrome-sandbox', 'shared'),
  )
}

/** 迁移 profile 目录后同步沙箱记录里的绝对 userDataPath，避免旧路径失效 */
function rewriteSandboxPaths(legacyRoot: string, nextRoot: string): void {
  const storePath = path.join(getChromeSandboxDataDirectory(), 'sandboxes.json')
  if (!existsSync(storePath)) return
  try {
    const list = JSON.parse(readFileSync(storePath, 'utf8')) as Array<Record<string, unknown>>
    if (!Array.isArray(list)) return
    let changed = false
    for (const item of list) {
      const current = item.userDataPath
      if (typeof current !== 'string') continue
      const relative = path.relative(legacyRoot, current)
      if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) continue
      item.userDataPath = path.join(nextRoot, relative)
      changed = true
    }
    if (changed) writeFileSync(storePath, `${JSON.stringify(list, null, 2)}\n`, 'utf8')
  } catch (error) {
    logger.warn('Failed to rewrite sandbox userDataPath after layout migration', {
      error: (error as Error).message,
    })
  }
}

function migrateInto(legacyPath: string, nextPath: string): LayoutRoot {
  if (!existsSync(legacyPath)) return 'tool'
  // 两边都存在时不做合并/改写：继续用旧布局，避免新目录缺少 profile 导致沙箱启动失败
  if (existsSync(nextPath)) return 'legacy'
  try {
    mkdirSync(path.dirname(nextPath), { recursive: true })
    renameSync(legacyPath, nextPath)
    return 'tool'
  } catch (error) {
    logger.warn('Failed to move chrome-sandbox directory into tool folder; keeping legacy layout', {
      from: legacyPath,
      to: nextPath,
      error: (error as Error).message,
    })
    return 'legacy'
  }
}

/** 所有沙箱 profile 的根目录：删除等写操作必须局限在此目录内 */
export function getSandboxesDirectory(): string {
  return sandboxesRoot === 'legacy'
    ? path.join(getDataDirectory(), 'sandboxes')
    : path.join(getDataDirectory(), 'chrome-sandbox', 'sandboxes')
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
  return sharedRoot === 'legacy'
    ? path.join(getDataDirectory(), 'shared', 'fingerprint_ext')
    : path.join(getDataDirectory(), 'chrome-sandbox', 'shared', 'fingerprint_ext')
}
