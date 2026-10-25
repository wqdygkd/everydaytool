import type { WindowAppearance } from '../shared/appearance.ts'
import type { ShellMenuAction } from '../shared/menu.ts'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { EDT_APP_IPC_CHANNELS } from '../backend/ipc/channels.ts'
import { registerAppIpcHandlers } from '../backend/ipc/handlers.ts'
import { getWindowAppearance, loadWindowAppearance } from '../backend/utils/appearance-store.ts'
import { loadDataDirectoryOverrideSync } from '../backend/utils/data-root.ts'
import { initIpcSafety } from '../backend/utils/ipc-safety.ts'
import { logger } from '../backend/utils/logger.ts'
import { configureSessionDataDirectory } from '../backend/utils/session-data.ts'
import {
  parseWindowsBuild,
  resolveAppearanceCapabilities,
  sanitizeWindowAppearance,
} from '../shared/appearance.ts'
import { isTrustedIpcSenderUrl } from '../shared/ipc-sender.ts'
import { SHELL_MENUS } from '../shared/menu.ts'
import { notifyDataDirectoryChanged, toolBackends } from './tool-registry.ts'

const require = createRequire(import.meta.url)
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron') as typeof import('electron')

// Chromium 会话数据（Cookies / Cache / LocalStorage / Partitions）必须在 ready 之前重定向到
// 应用数据目录；否则 persist 分区会固定落在 userData，只能靠链接搬移。
loadDataDirectoryOverrideSync()
configureSessionDataDirectory()

// 调试端口只在开发态（或 EDT_REMOTE_DEBUG=1 显式开启）下启用：
// Chromium 的 --remote-debugging-port=0 表示“启用并监听随机端口”，生产包必须完全不设置，
// 否则本机任意进程可发现并连接应用自身的 CDP。
const isDev = process.env.NODE_ENV === 'development' || process.env.EDT_REMOTE_DEBUG === '1'
if (isDev) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

// 页内菜单动作 → Electron role（role 自带标准行为与快捷键）。zoom 系列的 role 语义
// 与下方 ipc 处理器一致（±0.5 / 重置为 0）。Record 键穷举 ShellMenuAction：新增动作
// 漏映射时在编译期报错。
const ACTION_ROLES: Record<ShellMenuAction, NonNullable<Electron.MenuItemConstructorOptions['role']>> = {
  quit: 'quit',
  undo: 'undo',
  redo: 'redo',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  selectAll: 'selectAll',
  reload: 'reload',
  reloadIgnoringCache: 'forceReload',
  toggleDevTools: 'toggleDevTools',
  zoomIn: 'zoomIn',
  zoomOut: 'zoomOut',
  zoomReset: 'resetZoom',
  minimize: 'minimize',
  close: 'close',
}

// 应用菜单：Windows/Linux 渲染在系统菜单栏位置（标题栏下方），macOS 在屏幕顶部菜单栏。
// 菜单项清单见 shared/menu.ts（原页内菜单已移除，系统菜单是唯一渲染方）；仅系统菜单的
// 「视图」末尾额外追加全屏切换（webContents 无对应 IPC 动作）。
const menuTemplate: Electron.MenuItemConstructorOptions[] = [
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
  ...SHELL_MENUS.map<Electron.MenuItemConstructorOptions>(({ label, items }) => ({
    label,
    submenu: [
      ...items.flatMap<Electron.MenuItemConstructorOptions>(({ label: itemLabel, action, divided }) => [
        ...(divided ? [{ type: 'separator' as const }] : []),
        { label: itemLabel, role: ACTION_ROLES[action] },
      ]),
      ...(label === '视图' ? [{ type: 'separator' as const }, { role: 'togglefullscreen' as const, label: '全屏' }] : []),
    ],
  })),
]

Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))

// 编译产物 dist-electron/electron/main.js 中 import.meta.url 仍指向本文件所在目录，
// preload.cjs 与 ../dist/index.html 的相对关系与源码一致。
const __dirname = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'))

let mainWindow: Electron.BrowserWindow | null = null
let backendInitialized = false

// 自定义标题栏：header 即标题栏，右上角用原生 titleBarOverlay 窗口按钮。
// overlay 底色透明：标题栏自身有半透明表面色（见 App.vue 的 .app-header），
// 原生 overlay 若铺实色就会在右上角露出一块与整体不符的矩形，故放行 alpha 让其并入标题栏底色。
const TITLEBAR_COLORS = { color: '#00000000', symbolColor: '#000000' } as const

// 关闭半透明时的原生窗口底色：同样透明——外壳与各页面自理底色
// （工具页 .tool-page 自带 app-bg，首页透出桌面），窗口层不兜实色。
const OPAQUE_WINDOW_BG = '#00000000'

// ── 窗口外观（半透明 / 系统材质） ──
// 平台能力在进程启动时解析一次：Windows 要读系统版本判断是否 22H2+（否则 DWM 会忽略材质），
// 之后所有窗口创建 / IPC 设置都复用同一份结论，避免各处重复探测。
const APPEARANCE_CAPABILITIES = resolveAppearanceCapabilities(
  process.platform,
  process.platform === 'win32' ? parseWindowsBuild(process.getSystemVersion()) : null,
)

/**
 * 把外观配置映射成 BrowserWindow 的构造参数。
 * Windows：transparent 必须 frameless（Chromium 才会合成 alpha），且 thickFrame 决定
 * 缩放边框/阴影——开启透明时保留 thickFrame 以留住缩放与阴影，圆角交给 roundedCorners。
 * macOS：vibrancy 自带模糊背景，不能再叠 transparent（Electron 会报错），二者互斥。
 */
function buildAppearanceWindowOptions(appearance: WindowAppearance): Partial<Electron.BrowserWindowConstructorOptions> {
  const safe = sanitizeWindowAppearance(appearance, APPEARANCE_CAPABILITIES)
  if (!safe.enabled) return {}

  if (process.platform === 'darwin') {
    return safe.vibrancy === 'none' ? {} : { vibrancy: safe.vibrancy }
  }

  if (process.platform === 'win32') {
    const hasMaterial = safe.material !== 'none' && APPEARANCE_CAPABILITIES.supportsMaterial
    // 有系统材质时由 DWM 画背景（此时不能再透明，否则两层效果打架）；
    // 无材质（或旧系统）才走 transparent 让 CSS 背景的 alpha 透出桌面。
    return {
      ...(hasMaterial ? { backgroundMaterial: safe.material } : { transparent: true }),
      thickFrame: true,
      roundedCorners: true,
    }
  }

  // linux：无系统材质，且 transparent 依赖合成器，默认不支持（能力表已声明）
  return {}
}

/** 运行时切换外观：透明类开关只能改 CSS，材质 / vibrancy 走原生 setter */
function applyWindowAppearance(appearance: WindowAppearance): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const safe = sanitizeWindowAppearance(appearance, APPEARANCE_CAPABILITIES)

  if (process.platform === 'darwin') {
    win.setVibrancy(safe.enabled && safe.vibrancy !== 'none' ? safe.vibrancy : null)
  } else if (process.platform === 'win32') {
    const hasMaterial = safe.material !== 'none' && APPEARANCE_CAPABILITIES.supportsMaterial
    win.setBackgroundMaterial(hasMaterial && safe.enabled ? safe.material : 'none')
    // 透明开关随 CSS 类切换（见 App.vue 的 is-transparent）；此处只同步原生窗口底色
    if (!safe.enabled || hasMaterial) {
      win.setBackgroundColor(hasMaterial && safe.enabled ? '#00000000' : OPAQUE_WINDOW_BG)
    }
  }

  win.webContents.send(EDT_APP_IPC_CHANNELS.EVENT_APPEARANCE_CHANGED, safe)
  logger.info('Window appearance updated', { appearance: safe })
}

function adjustZoom(delta: number) {
  const wc = (BrowserWindow.getFocusedWindow() ?? mainWindow)?.webContents
  if (wc) wc.setZoomLevel(wc.getZoomLevel() + delta)
}

// 页内菜单动作的 IPC 入口（页内菜单已移除，桥接保留备用；动作定义见 shared/menu.ts）。
// Record 键穷举 ShellMenuAction：新增动作漏实现时在编译期报错；IPC 载荷运行时不经类型校验，未知值忽略。
ipcMain.on('edt:menu-action', (_event, action: ShellMenuAction) => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  const wc = win?.webContents
  const handlers: Record<ShellMenuAction, () => void> = {
    quit: () => app.quit(),
    undo: () => wc?.undo(),
    redo: () => wc?.redo(),
    cut: () => wc?.cut(),
    copy: () => wc?.copy(),
    paste: () => wc?.paste(),
    selectAll: () => wc?.selectAll(),
    reload: () => wc?.reload(),
    reloadIgnoringCache: () => wc?.reloadIgnoringCache(),
    toggleDevTools: () => wc?.toggleDevTools(),
    zoomIn: () => adjustZoom(0.5),
    zoomOut: () => adjustZoom(-0.5),
    zoomReset: () => wc?.setZoomLevel(0),
    minimize: () => win?.minimize(),
    close: () => win?.close(),
  }
  handlers[action]?.()
})

// IPC 来源白名单的根路径注入：必须在任何 safeHandle 注册之前执行。
// 不注就会导致打包后（file:// 协议）所有 IPC 调用被误判为不可信。
// 白名单规则见 shared/ipc-sender.ts：file: 必须位于 appPath 下，
// http(s) 仅限 localhost / 127.0.0.1 / [::1]（dev server），其余一律拒绝。
initIpcSafety({ appPath: app.getAppPath() })

// 平台级（应用壳）IPC：数据根目录管理 / 磁盘用量 / 缓存清理 / 窗口外观（preload 命名空间 edtApp）
registerAppIpcHandlers({
  notifyDataDirectoryChanged,
  applyWindowAppearance,
  getAppearanceCapabilities: () => APPEARANCE_CAPABILITIES,
})

async function initializeBackend(): Promise<void> {
  if (backendInitialized) return
  backendInitialized = true

  for (const backend of toolBackends) {
    try {
      await backend.initialize()
    } catch (error) {
      // 单工具初始化失败（如端口段耗尽）不拖垮其它工具：记错继续
      logger.error('Tool backend initialize failed', { error: (error as Error).message })
    }
  }
}

async function disposeBackend(): Promise<void> {
  for (const backend of [...toolBackends].reverse()) {
    await backend.dispose?.()
  }
}

// 新窗口 / webview 的协议白名单：只允许 http(s)。
// file://、data: 等一律拒绝，避免远程页面借 window.open / <webview src> 读本地文件或执行脚本。
function isSafeWebUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl || !rawUrl.trim()) return false
  try {
    const { protocol } = new URL(rawUrl.trim())
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 窗口级安全加固：
 * 1) will-attach-webview —— webview 的 preload 默认带 Node 集成，必须剥离；
 *    同时拒绝非 http(s) 的 src（防止 file:// 读本地文件）。
 * 2) setWindowOpenHandler —— 新窗口会继承父窗口的安全相关 webPreferences（含 preload），
 *    远程页面可借 window.open 拿到应用自身能力；这里全部 deny，外跳改走 edt:open-external。
 */
function hardenWindow(win: Electron.BrowserWindow): void {
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false

    const src = params?.src
    // src 为空时由业务代码稍后 loadURL 导航，此处只校验显式指定的地址
    if (src && !isSafeWebUrl(src)) {
      event.preventDefault()
    }
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

// 「外部打开」统一入口：window.open 已全部 deny，页面需要外跳时调用本通道，
// 由主进程校验协议后用系统默认浏览器打开（不再创建会继承父窗口配置的子窗口）。
ipcMain.on('edt:open-external', (event, rawUrl: string) => {
  if (!isSafeWebUrl(rawUrl)) return
  const frame = event.senderFrame as { origin?: string, url?: string } | null
  const sender = frame?.url || frame?.origin
  if (!isTrustedIpcSenderUrl(sender, { appPath: app.getAppPath() })) {
    logger.warn('Blocked untrusted open-external request')
    return
  }
  void shell.openExternal(rawUrl.trim())
})

async function createWindow(): Promise<void> {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: 'everydaytool',
    // 隐藏系统标题栏，网页头部即标题栏；
    // Windows/Linux 右上角保留原生最小化/最大化/关闭按钮，高度与 .app-header(44px) 对齐
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      // 红绿灯位置钉死（44px 顶栏内垂直居中），与 App.vue 中
      // .platform-darwin .app-header 的 padding-left 联动：改一处必须同步改另一处
      ? { trafficLightPosition: { x: 20, y: 16 } }
      : {
          titleBarOverlay: {
            color: TITLEBAR_COLORS.color,
            symbolColor: TITLEBAR_COLORS.symbolColor,
            height: 44,
          },
        }),
    // 半透明 / 系统材质按持久化配置决定窗口形态（默认关闭，外观与旧版一致）
    ...buildAppearanceWindowOptions(getWindowAppearance()),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  })

  hardenWindow(mainWindow)

  // 全屏时原生窗口控件隐藏（mac 红绿灯 / Win 右上按钮），通知渲染层收回标题栏预留边距；
  // mac 点绿灯进的是原生全屏，不经过 DOM fullscreen API，只能走主进程事件桥接
  const win = mainWindow
  const notifyFullscreen = () => {
    if (win.isDestroyed())
      return
    win.webContents.send(EDT_APP_IPC_CHANNELS.EVENT_FULLSCREEN_CHANGED, win.isFullScreen())
  }
  win.on('enter-full-screen', notifyFullscreen)
  win.on('leave-full-screen', notifyFullscreen)
  // 页面加载完成后推一次初始状态，避免渲染层默认值与窗口实际状态不一致
  win.webContents.on('did-finish-load', notifyFullscreen)

  mainWindow.on('closed', () => {
    // 置空避免后续菜单 / IPC 操作已销毁的 webContents 而抛异常
    mainWindow = null
  })

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173')
    // 本地开发默认不自动打开 DevTools（菜单「开发者工具」/F12 随时可开）；
    // 需要调试启动问题时用 EDT_DEVTOOLS=1 显式开启
    if (process.env.EDT_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist/index.html'))
  }
}

app.whenReady().then(async () => {
  await initializeBackend()
  // 外观必须先于 createWindow 读盘：窗口构造参数（transparent / vibrancy / backgroundMaterial）
  // 只在创建时生效，之后再改只能部分切换，读不到就等于这次启动丢了用户选择。
  await loadWindowAppearance()
  await createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow()
  }
})

// Electron 不会等待 async 的 before-quit 监听器：这里先阻止默认退出、显式完成清理后再退出，
// 保证数据库关闭（WAL checkpoint）、CDP 会话与外部子进程收尾真正执行完。
let quitting = false
app.on('before-quit', (event) => {
  if (quitting) return
  quitting = true
  event.preventDefault()
  void (async () => {
    try {
      await disposeBackend()
    } catch (error) {
      logger.error('Failed to dispose backend', { error: (error as Error).message })
    } finally {
      app.quit()
    }
  })()
})
