// Chrome 安装路径与沙箱 profile 路径（chrome-sandbox 工具域专属）。
// edt 应用数据根目录来自平台基建 backend/utils/data-root.ts。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { resolveLayerPath, resolveLegacyPath } from '../../../../backend/utils/data-layers.ts'
import { APP_ROOT_DEV, isDevEnvironment } from '../../../../backend/utils/data-root.ts'
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
  return isDevEnvironment
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

/** 配置层：沙箱列表 / 指纹 / 工具配置的 JSON 都落在 <data>/config/chrome-sandbox */
export function getChromeSandboxDataDirectory(): string {
  return resolveLayerPath('config', 'chrome-sandbox')
}

/** 会话层：沙箱 profile（Chrome --user-data-dir），含登录态，不可再生 */
function getSandboxesTargetDirectory(): string {
  return resolveLayerPath('session', 'sandbox')
}

/** 缓存层：共享指纹扩展（缺失时从 resources 重建） */
function getSharedTargetDirectory(): string {
  return resolveLayerPath('cache', 'chrome-sandbox', 'shared')
}

/**
 * pre-v1 的旧位置（早期把 profile / 共享扩展直接放在数据根下）。
 * v1 布局（`<data>/chrome-sandbox/sandboxes`）由启动期布局升级统一搬到 v2，这里只兜底 pre-v1。
 */
function getSandboxesLegacyDirectories(): string[] {
  // pre-v1 根下 profile / v1 工具目录下 profile：两处都只读回查，不写入
  return [resolveLegacyPath('sandboxes'), resolveLegacyPath('chrome-sandbox/sandboxes')]
}

function getSharedLegacyDirectories(): string[] {
  return [resolveLegacyPath('shared'), resolveLegacyPath('chrome-sandbox/shared')]
}

let sandboxesRoot = getSandboxesTargetDirectory()
let sharedRoot = getSharedTargetDirectory()

/**
 * 旧位置收编（v2 分层布局）：
 *   <data>/sandboxes                → <data>/session/sandbox          （profile，含登录态）
 *   <data>/chrome-sandbox/sandboxes → <data>/session/sandbox          （v1 布局，通常已由启动期升级搬走）
 *   <data>/shared                   → <data>/cache/chrome-sandbox/shared（可重建）
 *   <data>/chrome-sandbox/shared    → 同上
 * 旧目录被 Chrome 占用时 rename 会失败，本次运行继续用旧位置（不复制、不破坏运行中的 profile）。
 */
export function ensureChromeSandboxLayout(): void {
  const sandboxes = migrateInto(getSandboxesLegacyDirectories(), getSandboxesTargetDirectory())
  sandboxesRoot = sandboxes.directory
  const shared = migrateInto(getSharedLegacyDirectories(), getSharedTargetDirectory())
  sharedRoot = shared.directory
  // 记录里的绝对路径可能仍指向旧根：统一收敛到当前生效的 profile 根
  rewriteSandboxPaths()
}

/** 迁移 profile 目录后同步沙箱记录里的绝对 userDataPath，避免旧路径失效 */
function rewriteSandboxPaths(): void {
  const storePath = path.join(getChromeSandboxDataDirectory(), 'sandboxes.json')
  if (!existsSync(storePath)) return
  const target = sandboxesRoot
  const targets = [getSandboxesTargetDirectory(), ...getSandboxesLegacyDirectories()]
  try {
    const list = JSON.parse(readFileSync(storePath, 'utf8')) as Array<Record<string, unknown>>
    if (!Array.isArray(list)) return
    let changed = false
    for (const item of list) {
      const current = item.userDataPath
      if (typeof current !== 'string') continue
      const legacyRoot = targets.find((root) => {
        const relative = path.relative(root, current)
        return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
      })
      if (!legacyRoot || legacyRoot === target) continue
      item.userDataPath = path.join(target, path.relative(legacyRoot, current))
      changed = true
    }
    if (changed) writeFileSync(storePath, `${JSON.stringify(list, null, 2)}\n`, 'utf8')
  } catch (error) {
    logger.warn('Failed to rewrite sandbox userDataPath after layout migration', {
      error: (error as Error).message,
    })
  }
}

interface MigrateResult {
  /** 最终生效的根目录 */
  directory: string
  /** 是否仍在使用旧位置（本进程内回退：Chrome 占用导致 rename 失败） */
  legacy: boolean
}

function migrateInto(legacyPaths: string[], targetPath: string): MigrateResult {
  const existingLegacy = legacyPaths.find(item => existsSync(item))
  if (!existingLegacy) return { directory: targetPath, legacy: false }
  if (existsSync(targetPath)) {
    logger.info('Legacy directory kept untouched; new layout location already exists', {
      legacy: existingLegacy,
      target: targetPath,
    })
    return { directory: targetPath, legacy: false }
  }
  try {
    mkdirSync(path.dirname(targetPath), { recursive: true })
    renameSync(existingLegacy, targetPath)
    return { directory: targetPath, legacy: false }
  } catch (error) {
    // Chrome 正在使用旧目录：本次运行继续用旧位置（不复制、不破坏运行中的 profile）
    logger.warn('Failed to move legacy directory into new layout; using legacy location', {
      from: existingLegacy,
      to: targetPath,
      error: (error as Error).message,
    })
    return { directory: existingLegacy, legacy: true }
  }
}

/** 所有沙箱 profile 的根目录：删除等写操作必须局限在此目录内 */
export function getSandboxesDirectory(): string {
  return sandboxesRoot
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
  return path.join(sharedRoot, 'fingerprint_ext')
}
