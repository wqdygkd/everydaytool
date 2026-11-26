/**
 * 云枢 / eagleyun SASE 客户端的残留清单（写死在代码里，运行期不接受外部路径）。
 * 单一事实来源：扫描、清理、保护判定都从这里读。
 */
import os from 'node:os'
import path from 'node:path'

export const HOME = os.homedir()

/** 文件与目录目标；支持 ~ 前缀与末段通配符 `*`。kind 用于「不存在」时也能说清它本该是什么 */
export interface FileTarget {
  pattern: string
  kind: string
}

export const FILE_TARGETS: FileTarget[] = [
  { pattern: '/Applications/Yunshu.app', kind: 'App' },
  { pattern: '/Library/Application Support/Yunshu', kind: '目录' },
  { pattern: '/Library/Application Support/EagleCloud', kind: '目录' },
  { pattern: '/opt/.yunshu', kind: '目录' },
  { pattern: '/opt/yunshu', kind: '目录' },
  { pattern: '/Library/LaunchAgents/com.eagleyun.endpoint.agent.plist', kind: 'plist' },
  { pattern: '/Library/LaunchDaemons/com.eagleyun.sase.helper.plist', kind: 'plist' },
  { pattern: '/Library/LaunchDaemons/com.eagleyun.sase.servicemanager.plist', kind: 'plist' },
  { pattern: '/Library/PrivilegedHelperTools/com.eagleyun.sase.helper', kind: '特权 helper' },
  { pattern: '/Library/Logs/com.eagleyun.sase.helper', kind: '日志目录' },
  { pattern: '/Library/Logs/DiagnosticReports/*Yunshu*', kind: '崩溃报告' },
  { pattern: '/Library/Logs/DiagnosticReports/*eagleyun*', kind: '崩溃报告' },
  { pattern: '~/Library/Logs/com.eagleyun.sase', kind: '日志目录' },
  { pattern: '~/Library/Logs/DiagnosticReports/*Yunshu*', kind: '崩溃报告' },
  { pattern: '~/Library/Logs/DiagnosticReports/*eagleyun*', kind: '崩溃报告' },
  { pattern: '~/Library/Preferences/com.eagleyun.sase.plist', kind: '偏好设置' },
  { pattern: '~/Library/Preferences/com.eagleyun.endpoint.agent.plist', kind: '偏好设置' },
  { pattern: '~/Library/Application Support/EagleCloud', kind: '目录' },
  { pattern: '~/Library/Caches/com.eagleyun.endpoint.agent', kind: '缓存目录' },
  { pattern: '~/Library/HTTPStorages/com.eagleyun.sase', kind: 'HTTP 存储' },
  { pattern: '~/Library/HTTPStorages/com.eagleyun.endpoint.agent', kind: 'HTTP 存储' },
  { pattern: '~/Library/WebKit/com.eagleyun.sase', kind: 'WebKit 数据' },
  { pattern: '/tmp/tbmdmexecutor-ipc-*', kind: '临时 IPC 文件' },
]

export interface ServiceTarget {
  label: string
  /** launchd 域：系统守护进程 / 用户登录代理 */
  domain: 'system' | 'gui'
  plist: string
}

export const SERVICE_TARGETS: ServiceTarget[] = [
  { label: 'com.eagleyun.sase.helper', domain: 'system', plist: '/Library/LaunchDaemons/com.eagleyun.sase.helper.plist' },
  { label: 'com.eagleyun.sase.servicemanager', domain: 'system', plist: '/Library/LaunchDaemons/com.eagleyun.sase.servicemanager.plist' },
  { label: 'com.eagleyun.endpoint.agent', domain: 'gui', plist: '/Library/LaunchAgents/com.eagleyun.endpoint.agent.plist' },
]

/** pgrep -f 的匹配式；命中的进程在清理时先 TERM 后 KILL */
export const PROCESS_TARGETS = [
  { pattern: 'Yunshu.app/Contents/MacOS', label: '云枢主程序进程' },
  { pattern: 'com\\.eagleyun', label: 'eagleyun 辅助进程' },
] as const

export const CERT_TARGET = {
  commonName: 'EagleCloud Root CA',
  /** 证书里的邮箱（别名），用于第二条检索路径 */
  email: 'sase@eagleyun.com',
  /** 已知这张证书的 SHA-256（大写无冒号）；指纹不一致时只提示、不自动删 */
  sha256: '3192903784B99E65DAB7FCFD00EEAB4218BE2E242BED201111DE637945ECD448',
  keychains: [
    { path: path.join(HOME, 'Library/Keychains/login.keychain-db'), needsAdmin: false, name: '登录钥匙串' },
    { path: '/Library/Keychains/System.keychain', needsAdmin: true, name: '系统钥匙串' },
  ],
} as const

/** 只提示、不清理的系统文件（手改会让系统重置整份网络扩展配置） */
export const NOTE_TARGETS = [
  {
    id: 'note-ne',
    path: '/Library/Preferences/com.apple.networkextension.plist',
    detail: '含 com.eagleyun.* 历史引用；二进制已不在即无放行能力，不改系统文件',
  },
] as const

/** 绝不允许删除的锚点：只钉容器本身，子项照常可删 */
const PROTECTED_EXACT = new Set([
  '/',
  '/Applications',
  '/Library',
  '/Library/Application Support',
  '/Library/LaunchAgents',
  '/Library/LaunchDaemons',
  '/Library/Logs',
  '/Library/Logs/DiagnosticReports',
  '/Library/Preferences',
  '/Library/PrivilegedHelperTools',
  '/Library/Keychains',
  '/Library/Keychains/System.keychain',
  '/opt',
  '/tmp',
  '/private',
  '/private/tmp',
  '/System',
  '/usr',
  '/bin',
  '/sbin',
  '/etc',
  '/var',
  '/dev',
  '/Users',
  '/Volumes',
  '/cores',
  HOME,
  path.join(HOME, '.Trash'),
  path.join(HOME, 'Library'),
  path.join(HOME, 'Library/Application Support'),
  path.join(HOME, 'Library/Logs'),
  path.join(HOME, 'Library/Preferences'),
  path.join(HOME, 'Library/Keychains'),
])

/** 需要 root 才能移走的系统目录前缀 */
const ADMIN_PREFIXES = ['/Applications/', '/Library/', '/opt/']

export function expandHome(target: string): string {
  return target === '~' ? HOME : target.startsWith('~/') ? path.join(HOME, target.slice(2)) : target
}

export function requiredAdmin(absPath: string): boolean {
  return ADMIN_PREFIXES.some(prefix => absPath.startsWith(prefix))
}

export function isProtectedPath(absPath: string): boolean {
  if (!absPath.startsWith('/')) return true
  if (absPath.includes('..')) return true
  if (PROTECTED_EXACT.has(absPath)) return true
  return false
}

/** 展示用：家目录缩写回 ~ */
export function shortenForDisplay(absPath: string): string {
  if (absPath === HOME) return '~'
  if (absPath.startsWith(`${HOME}/`)) return `~/${absPath.slice(HOME.length + 1)}`
  return absPath
}

/** 钥匙串路径是系统文件却不该被删，扫描时会单独标注 */
export function isKeychainPath(absPath: string): boolean {
  return CERT_TARGET.keychains.some(entry => entry.path === absPath)
}
