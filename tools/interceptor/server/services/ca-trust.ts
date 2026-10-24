// 根 CA 的信任安装 / 卸载 / 状态检测（Windows 用户根证书库 / macOS 登录钥匙串）。
// 方案见 docs/interceptor.md §6：
// - Windows：certutil -user（免提权，用户库即 Chrome 生效范围），查/删走 SHA1 指纹；
// - macOS：登录钥匙串 + osascript 确认框（不用 System.keychain / 无需管理员）。
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { logger } from '../../../../server/utils/logger.ts'
import { runCommand } from '../utils/exec.ts'

export interface CaTrustResult {
  ok: boolean
  /** 失败原因（区分“用户取消”与一般失败，UI 提示用） */
  canceled?: boolean
  detail?: string
}

export interface CaTrustStateResult {
  state: 'not-found' | 'installed' | 'trusted' | 'installed-untrusted' | 'error'
  detail?: string
}

function normalizeFingerprint(raw: string): string {
  return raw.replace(/[^0-9a-f]/gi, '').toUpperCase()
}

function getMacLoginKeychainPath(): string {
  return path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db')
}

/** 单引号安全包裹：`'` → `'\''`（osascript do shell script 内路径含特殊字符时不破链） */
function shQuote(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

async function findWindows(fingerprint: string): Promise<boolean> {
  const result = await runCommand('certutil', ['-user', '-verifystore', 'Root', fingerprint])
  return result.code === 0
}

async function getWindowsTrustState(fingerprint: string): Promise<CaTrustStateResult> {
  try {
    const found = await findWindows(fingerprint)
    // Windows 用户库只有“在 / 不在”，存在即在信任范围（无独立 trust 设置）
    return found ? { state: 'trusted' } : { state: 'not-found' }
  } catch (error) {
    return { state: 'error', detail: (error as Error).message }
  }
}

async function installWindows(certPath: string): Promise<CaTrustResult> {
  const result = await runCommand('certutil', ['-user', '-addstore', '-f', 'Root', certPath])
  if (result.code === 0) return { ok: true }
  return {
    ok: false,
    detail: (result.stderr || result.stdout || '').trim() || `certutil 退出码 ${result.code}`,
  }
}

async function uninstallWindows(fingerprint: string): Promise<CaTrustResult> {
  const result = await runCommand('certutil', ['-user', '-delstore', 'Root', fingerprint])
  if (result.code === 0) return { ok: true }
  const output = (result.stderr || result.stdout || '').trim()
  // 证书本就不存在时视为幂等成功
  if (/not found|找不到/i.test(output)) return { ok: true }
  return { ok: false, detail: output || `certutil 退出码 ${result.code}` }
}

// ---------------------------------------------------------------------------
// macOS（登录钥匙串）
// ---------------------------------------------------------------------------

interface MacFindResult {
  found: boolean
  trustSettings: 'trusted' | 'deny' | 'none'
}

async function findMac(fingerprint: string): Promise<MacFindResult> {
  const keychain = getMacLoginKeychainPath()
  const find = await runCommand('security', ['find-certificate', '-a', '-Z', '-c', 'edt Interceptor CA', keychain])
  const found = find.code === 0 && normalizeFingerprint(find.stdout).includes(fingerprint)
  if (!found) return { found: false, trustSettings: 'none' }

  // 用户信任设置：dump-trust-settings 中仅在“存在非 Deny 结果”时才算被信任
  const dump = await runCommand('security', ['dump-trust-settings'])
  const lines = dump.stdout.split('\n')
  let trustSettings: MacFindResult['trustSettings'] = 'none'
  for (let i = 0; i < lines.length; i++) {
    if (normalizeFingerprint(lines[i]).includes(fingerprint)) {
      const window = lines.slice(i, i + 8).join('\n')
      if (/kSecTrustSettingsResultDeny/.test(window)) trustSettings = 'deny'
      else if (/kSecTrustSettingsResult/.test(window)) trustSettings = 'trusted'
      break
    }
  }
  return { found: true, trustSettings }
}

async function getMacTrustState(fingerprint: string): Promise<CaTrustStateResult> {
  try {
    const { found, trustSettings } = await findMac(fingerprint)
    if (!found) return { state: 'not-found' }
    if (trustSettings === 'trusted') return { state: 'trusted' }
    // 证书在钥匙串但无显式信任（或显式 Deny）——Chrome 不认，需重新安装
    return { state: 'installed-untrusted', detail: '证书已导入但未设为信任，请重新执行安装' }
  } catch (error) {
    return { state: 'error', detail: (error as Error).message }
  }
}

async function installMac(certPath: string): Promise<CaTrustResult> {
  const keychain = getMacLoginKeychainPath()
  // 注意：路径必须用解析后的真实路径——`'$HOME/...'` 单引号在 do shell script 下不做变量展开，
  // security 会拿到字面 $HOME 路径而失败（find/delete 用的就是解析路径，保持一致）
  const shellCommand = `security add-trusted-cert -r trustRoot -k ${shQuote(keychain)} ${shQuote(certPath)}`
  const script = `do shell script ${JSON.stringify(shellCommand)} with prompt "edt 请求将根证书加入登录钥匙串并设为信任"`

  const result = await runCommand('osascript', ['-e', script])
  if (result.code === 0) return { ok: true }

  const output = `${result.stderr}\n${result.stdout}`
  if (/cancel|取消|-128/i.test(output)) {
    return { ok: false, canceled: true, detail: '已取消授权' }
  }
  logger.warn('macOS CA install failed', { output: output.trim(), keychain })
  return { ok: false, detail: output.trim() || `osascript 退出码 ${result.code}` }
}

async function uninstallMac(fingerprint: string): Promise<CaTrustResult> {
  const keychain = getMacLoginKeychainPath()
  const result = await runCommand('security', ['delete-certificate', '-Z', fingerprint, keychain])
  if (result.code === 0) return { ok: true }
  const output = `${result.stderr}\n${result.stdout}`.trim()
  if (/could not be found|not found/i.test(output)) return { ok: true }
  return { ok: false, detail: output || `security 退出码 ${result.code}` }
}

// ---------------------------------------------------------------------------
// 平台分派
// ---------------------------------------------------------------------------

export async function getCaTrustState(fingerprint: string): Promise<CaTrustStateResult> {
  if (process.platform === 'win32') return getWindowsTrustState(fingerprint)
  if (process.platform === 'darwin') return getMacTrustState(fingerprint)
  return { state: 'error', detail: '当前平台暂不支持自动管理证书信任' }
}

export async function installCaTrust(certPath: string): Promise<CaTrustResult> {
  if (process.platform === 'win32') return installWindows(certPath)
  if (process.platform === 'darwin') return installMac(certPath)
  return { ok: false, detail: '当前平台暂不支持自动安装证书' }
}

export async function uninstallCaTrust(fingerprint: string): Promise<CaTrustResult> {
  if (process.platform === 'win32') return uninstallWindows(fingerprint)
  if (process.platform === 'darwin') return uninstallMac(fingerprint)
  return { ok: false, detail: '当前平台暂不支持自动卸载证书' }
}
