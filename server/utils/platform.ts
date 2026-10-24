// 桌面宿主平台能力（app / dialog / shell / session）。
// Rust 侧通过环境变量注入同步路径信息，通过 platform transport 提供异步能力
// （目录/文件对话框、打开路径/外链、WebView 缓存清理、DevTools）。
// server/** 与 tools/*/server/** 只依赖这一层，不直接接触 Tauri 或系统 API。
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export interface PlatformTransport {
  /** 发往 Rust 宿主的平台能力请求（op 见 sidecar/transport.ts 或 src-tauri/src/sidecar.rs） */
  request: (op: string, args: Record<string, unknown>) => Promise<unknown>
  /** 主进程 → 渲染层事件（Rust 转发为 Tauri 事件） */
  event: (channel: string, payload: unknown) => void
}

let transport: PlatformTransport | null = null

export function installPlatformTransport(next: PlatformTransport): void {
  transport = next
}

export function getPlatformTransport(): PlatformTransport {
  if (!transport) throw new Error('桌面运行时尚未就绪（平台通道未安装）')
  return transport
}

const env = process.env

/** 是否打包态（Rust 启动 Node 运行时注入 EDT_IS_PACKAGED=1） */
export const isPackaged = env.EDT_IS_PACKAGED === '1'
export const isDev = !isPackaged

/** 应用根目录：dev = 项目根；打包 = 可执行文件目录 */
const appRoot = env.EDT_APP_ROOT || process.cwd()
/** 打包资源目录（扩展模板等）：dev = 项目根；打包 = Tauri resourceDir */
const resourcesRoot = env.EDT_RESOURCES || appRoot
/** 桌面 userData 目录 */
const userDataDir = env.EDT_USER_DATA || defaultUserDataDir()
const appVersion = env.EDT_APP_VERSION || '1.1.0'

function defaultUserDataDir(): string {
  if (process.platform === 'win32') {
    return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'everydaytool')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'everydaytool')
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'everydaytool')
}

export const runtime = {
  isPackaged,
  version: appVersion,
  appRoot,
  resourcesRoot,
  userDataDir,
  exePath: process.execPath,
  tempDir: os.tmpdir(),
  homeDir: os.homedir(),
}

export interface OpenDialogOptions {
  title?: string
  defaultPath?: string
  properties?: string[]
  filters?: Array<{ name: string, extensions: string[] }>
}

export interface OpenDialogResult {
  canceled: boolean
  filePaths: string[]
}

export interface SaveDialogOptions {
  title?: string
  defaultPath?: string
  filters?: Array<{ name: string, extensions: string[] }>
}

export interface SaveDialogResult {
  canceled: boolean
  filePath?: string
}

export const fileDialog = {
  async open(options: OpenDialogOptions = {}): Promise<OpenDialogResult> {
    const result = await getPlatformTransport().request('dialog.open', options as Record<string, unknown>)
    return normalizeOpenResult(result)
  },
  async save(options: SaveDialogOptions = {}): Promise<SaveDialogResult> {
    const result = await getPlatformTransport().request('dialog.save', options as Record<string, unknown>)
    return normalizeSaveResult(result)
  },
}

function normalizeOpenResult(raw: unknown): OpenDialogResult {
  const value = raw as { filePaths?: unknown } | null
  const paths = Array.isArray(value?.filePaths) ? value.filePaths.filter((p): p is string => typeof p === 'string') : []
  return { canceled: paths.length === 0, filePaths: paths }
}

function normalizeSaveResult(raw: unknown): SaveDialogResult {
  const value = raw as { filePath?: unknown } | null
  const filePath = typeof value?.filePath === 'string' ? value.filePath : undefined
  return filePath ? { canceled: false, filePath } : { canceled: true }
}

export const system = {
  /** 成功返回空串，失败返回错误信息 */
  async openPath(targetPath: string): Promise<string> {
    const result = await getPlatformTransport().request('system.openPath', { path: targetPath })
    return typeof result === 'string' ? result : ''
  },
  async openExternal(url: string): Promise<void> {
    await getPlatformTransport().request('system.openExternal', { url })
  },
}

export const webview = {
  /** 清理主 WebView 的 HTTP 缓存 */
  async clearCache(): Promise<void> {
    await getPlatformTransport().request('webview.clearCache', {})
  },
  /** 打开独立 DevTools 窗口 */
  async openDevTools(): Promise<void> {
    await getPlatformTransport().request('webview.openDevTools', {})
  },
}
