import type { WindowAppearance } from '../shared/appearance.ts'
import type { ShellMenuAction } from '../shared/menu.ts'
import type { WindowBoundsState } from '../shared/window-bounds.ts'
import path from 'node:path'
import process from 'node:process'
import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell } from 'electron'
import { EDT_APP_IPC_CHANNELS } from '../backend/ipc/channels.ts'
import { registerAppIpcHandlers } from '../backend/ipc/handlers.ts'
import { configureInstanceIdentity } from '../backend/utils/app-instance.ts'
import { getWindowAppearance, loadWindowAppearance } from '../backend/utils/appearance-store.ts'
import { getAssetsRoot, loadAssetsRootSync } from '../backend/utils/assets-root.ts'
import { upgradeDataLayout } from '../backend/utils/data-layout-upgrade.ts'
import { getDataDirectory, isDevEnvironment, loadDataDirectoryOverrideSync } from '../backend/utils/data-root.ts'
import { initIpcSafety, safeOn } from '../backend/utils/ipc-safety.ts'
import { isTrustedIpcSenderUrl } from '../backend/utils/ipc-sender.ts'
import { logger } from '../backend/utils/logger.ts'
import { configureSessionDataDirectory } from '../backend/utils/session-data.ts'
import { clearWindowBoundsGeometry, getWindowBoundsState, loadWindowBounds, recordWindowBounds, setWindowBoundsEnabled } from '../backend/utils/window-bounds-store.ts'
import { parseWindowsBuild, resolveAppearanceCapabilities, resolveWindowAppearance, sanitizeWindowAppearance } from '../shared/appearance.ts'
import { SHELL_MENUS } from '../shared/menu.ts'
import { DEFAULT_WINDOW_SIZE, MIN_WINDOW_SIZE, resolveWindowPlacement } from '../shared/window-bounds.ts'
import { applyDevDockIcon, resolveDevWindowIconPath } from './dev-icon.ts'
import { toolBackends } from './tool-registry.ts'

// 应用身份先定：开发态把 userData 换成 `<appData>/<应用名>-dev`，与安装版各持一把
// Chromium 单实例锁，两者才能同时运行（见 backend/utils/app-instance.ts）。
// 必须排在下面 loadDataDirectoryOverrideSync 之前——引导配置 data-root.json 就住在 userData 里。
const userDataDirectory = configureInstanceIdentity()

// 启动顺序（不能变）：
// 1. 数据目录地址（含 pending 迁移）——其它根的位置都以它为基准；
// 2. 资产根（独立根，含 pending 迁移）——升级器要读它才知道归档搬到哪；
// 3. v1 平铺布局 → v2 分层布局的升级——必须在 Chromium 打开会话文件之前完成；
// 4. 重定向 Chromium 会话目录到 session 层（见 docs/data-layers.md §9）。
loadDataDirectoryOverrideSync()
loadAssetsRootSync()
upgradeDataLayoutAtStartup()
configureSessionDataDirectory()

if (isDevEnvironment) {
  // 两种形态同时在跑时，日志里要能一眼看出这一条来自哪个 profile
  logger.info('Development instance profile', { userData: userDataDirectory, data: getDataDirectory() })
}

// 调试端口只在显式开启时启用：pnpm dev 由 dev-electron.mjs 注入 NODE_ENV=development；
// 运行构建产物调试用 EDT_REMOTE_DEBUG=1（只开 CDP，仍加载 dist 页面）。生产启动不带任何
// CDP 参数——本机任意进程都能发现 --remote-debugging-port 暴露的调试端点，不设就是关着的。
const isDevServer = process.env.NODE_ENV === 'development'
const isDebugging = isDevServer || process.env.EDT_REMOTE_DEBUG === '1'
if (isDebugging) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
}

// 页内菜单动作 → Electron role（role 自带标准行为与快捷键）。zoom 系列的 role 语义
// 与旧版页内菜单一致（±0.5 / 重置为 0）。Record 键穷举 ShellMenuAction：新增动作
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

const TITLEBAR_COLORS = { color: '#00000000', symbolColor: '#000000' } as const

// 窗口原生底色：恒透明——外壳与各页面自理底色
// （工具页 .tool-page 自带 app-bg，首页透出桌面），窗口层不兜实色。
const TRANSPARENT_WINDOW_BG = '#00000000'

// ── 窗口大小 / 位置 ──
// 记录用 debounce：拖动 / 缩放会连续触发 resize / move，攒到 400ms 才落一次盘；
// 关窗时立即同步写入——退出流程没有等异步写的余量。
const WINDOW_BOUNDS_SAVE_DELAY = 400

// ── 窗口外观（半透明 / 系统材质） ──
// 平台能力在进程启动时解析一次：Windows 要读系统版本判断是否 22H2+（否则 DWM 会忽略材质），
// 之后所有窗口创建 / IPC 设置都复用同一份结论，避免各处重复探测。
const APPEARANCE_CAPABILITIES = resolveAppearanceCapabilities(
  process.platform,
  process.platform === 'win32' ? parseWindowsBuild(process.getSystemVersion()) : null,
)

/**
 * 启动期把数据布局从 v1（平铺 `<data>/<工具>/…`）升级到 v2（`config` / `session` / `cache` 三层）。
 * 幂等且失败安全：单条搬迁失败只记日志、文件留在旧位置（读取方用 resolveLayerPathWithFallback 回查），
 * 只有零错误零冲突时才写布局版本标记。整段同步执行，必须在 Chromium 打开会话文件之前完成。
 *
 * 唯一的**硬拒绝**：数据根的 `layoutVersion` 高于本版支持值（数据来自更新的应用）。
 * 这时一个字节都不动——老版本按自己的理解往新版布局里写只会毁数据。给出提示后退出，
 * 逃生开关 `EDT_ALLOW_FUTURE_LAYOUT=1` 用于「明知风险、只想打开看一眼」的场景。
 */
function upgradeDataLayoutAtStartup(): void {
  try {
    const result = upgradeDataLayout({ dataDirectory: getDataDirectory(), assetsRoot: getAssetsRoot() })
    if (result.blockedByNewerLayout) {
      const detail = `数据目录 ${getDataDirectory()} 的布局版本是 v${result.plan.fromVersion}，`
        + `高于本版应用支持的 v${result.plan.toVersion}。请升级应用，或把数据目录指回兼容的目录。`
      logger.error('Refusing to start: data layout is newer than this app version', {
        dataDirectory: getDataDirectory(),
        layoutVersion: result.plan.fromVersion,
        supportedVersion: result.plan.toVersion,
      })
      if (process.env.EDT_ALLOW_FUTURE_LAYOUT === '1') {
        logger.warn('EDT_ALLOW_FUTURE_LAYOUT=1: continuing with a newer data layout (data may be damaged)')
        return
      }
      dialog.showErrorBox('数据版本过新', detail)
      app.exit(1)
      return
    }
    if (result.dryRun || result.plan.fromVersion === result.plan.toVersion) return
    logger.info('Data layout upgrade finished', {
      moved: result.movedCount,
      bytes: result.movedBytes,
      quarantined: result.plan.quarantined.length,
      untouchedUnknown: result.plan.untouchedUnknown.length,
      errors: result.errors.length,
      versionWritten: result.versionWritten,
    })
    if (result.errors.length > 0) {
      logger.warn('Data layout upgrade left entries in legacy locations', { errors: result.errors })
    }
  } catch (error) {
    // 升级失败绝不能阻止启动：老路径仍在，工具仍能按 v1 布局工作
    logger.warn('Data layout upgrade failed; continuing with current layout', { error: (error as Error).message })
  }
}

let mainWindow: BrowserWindow | null = null
let backendInitialized = false

// ── 应用菜单 ──
// 菜单项清单见 shared/menu.ts；系统菜单是唯一渲染方。仅「视图」末尾额外追加全屏切换
// （webContents 无对应 IPC 动作）。菜单在 ready 前设置是允许的，窗口创建后自动套用。
function buildApplicationMenu(): void {
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
}

/**
 * 把外观配置映射成 BrowserWindow 的构造参数。
 * 生效形态（是否透明 / 材质 / vibrancy）由 shared/appearance.ts 的 resolveWindowAppearance 判定，
 * 这里只补 BrowserWindow 专有的几何参数：Windows 保留 thickFrame（缩放边框/阴影）并开圆角。
 */
function buildAppearanceWindowOptions(appearance: WindowAppearance): Partial<Electron.BrowserWindowConstructorOptions> {
  const plan = resolveWindowAppearance(appearance, APPEARANCE_CAPABILITIES)
  if (!plan.enabled) return {}

  if (plan.vibrancy !== 'none') return { vibrancy: plan.vibrancy }
  if (plan.transparent) return { transparent: true, thickFrame: true, roundedCorners: true }
  if (plan.material !== 'none') return { backgroundMaterial: plan.material, thickFrame: true, roundedCorners: true }
  return {}
}

/** 运行时切换外观：透明类开关只能改 CSS，材质 / vibrancy 走原生 setter */
function applyWindowAppearance(appearance: WindowAppearance): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  const plan = resolveWindowAppearance(appearance, APPEARANCE_CAPABILITIES)

  if (process.platform === 'darwin') {
    win.setVibrancy(plan.vibrancy === 'none' ? null : plan.vibrancy)
  } else if (process.platform === 'win32') {
    win.setBackgroundMaterial(plan.material)
    // 透明开关随 CSS 类切换（见 App.vue 的 is-transparent）；此处只同步原生窗口底色（恒全透明）
    win.setBackgroundColor(TRANSPARENT_WINDOW_BG)
  }

  const safe = sanitizeWindowAppearance(appearance, APPEARANCE_CAPABILITIES)
  win.webContents.send(EDT_APP_IPC_CHANNELS.EVENT_APPEARANCE_CHANGED, safe)
  logger.info('Window appearance updated', { appearance: safe })
}

/**
 * 把持久化的窗口几何换算成 BrowserWindow 构造参数：
 * 是否恢复、恢复到哪里由 shared/window-bounds.ts 的纯函数决断（屏幕拔掉 / 分辨率变小会
 * 自动放弃恢复，改用默认尺寸让 Electron 居中）。
 */
function resolveWindowBoundsOptions(): { options: Partial<Electron.BrowserWindowConstructorOptions>, maximized: boolean } {
  const placement = resolveWindowPlacement(
    getWindowBoundsState(),
    screen.getAllDisplays().map(display => display.workArea),
  )
  if (!placement) return { options: { ...DEFAULT_WINDOW_SIZE }, maximized: false }
  return { options: { ...placement.bounds }, maximized: placement.maximized }
}

/** 设置页开关：关闭后不再记录；重新开启时补记一次当前几何，避免下次启动跳回关闭前的老位置 */
function setWindowBoundsEnabledFromUi(enabled: boolean): WindowBoundsState {
  const state = setWindowBoundsEnabled(enabled)
  const win = mainWindow
  if (!enabled || !win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return state
  recordWindowBounds(win.getNormalBounds(), win.isMaximized())
  return getWindowBoundsState()
}

/** 设置页「重置为默认大小」：清掉记录，把当前窗口收回默认尺寸并居中（新几何随即重新记录） */
function resetWindowBounds(): WindowBoundsState {
  clearWindowBoundsGeometry()

  const win = mainWindow
  if (!win || win.isDestroyed()) return getWindowBoundsState()

  if (win.isFullScreen()) win.setFullScreen(false)
  if (win.isMaximized()) win.unmaximize()
  win.setSize(DEFAULT_WINDOW_SIZE.width, DEFAULT_WINDOW_SIZE.height)
  win.center()
  recordWindowBounds(win.getNormalBounds(), win.isMaximized())
  return getWindowBoundsState()
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
 * 主窗口只允许停留在自身页面：打包后 dist/index.html（file: 且在 appPath 下）与开发态本机 dev server；
 *  注意白名单按 loopback 放行——任意 http://localhost:<port> 都算自身来源（与 IPC 来源校验同一规则）。
 */
function isAppOwnUrl(url: string | undefined): boolean {
  return isTrustedIpcSenderUrl(url, { appPath: app.getAppPath() })
}

// ── 权限策略 ──
// 默认拒绝，按会话白名单放行。主会话（应用自身页面）只需要剪贴板写与全屏（复制按钮 / 全屏 API）；
// webview 分区（env-browser / treease / telegram 浏览真实站点）按浏览器语义放行常见浏览权限。
// 其余（openExternal、clipboard-read 等）一律拒绝——外跳统一走 edt-app:open-external。
const APP_SESSION_PERMISSIONS = new Set<string>(['clipboard-sanitized-write', 'fullscreen'])
const GUEST_SESSION_PERMISSIONS = new Set<string>([
  'clipboard-sanitized-write',
  'display-capture',
  'fullscreen',
  'geolocation',
  'keyboardLock',
  'media',
  'notifications',
  'pointerLock',
  'storage-access',
])

function configureSessionPermissions(target: Electron.Session): void {
  const allow = target === session.defaultSession ? APP_SESSION_PERMISSIONS : GUEST_SESSION_PERMISSIONS
  target.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allow.has(permission))
  })
  target.setPermissionCheckHandler((_webContents, permission) => allow.has(permission))
}

/**
 * 窗口级安全加固：
 * 1) will-attach-webview —— webview 的 preload 默认带 Node 集成，必须剥离；
 *    同时拒绝非 http(s) 的 src（防止 file:// 读本地文件）。
 * 2) setWindowOpenHandler —— 新窗口会继承父窗口的安全相关 webPreferences（含 preload），
 *    远程页面可借 window.open 拿到应用自身能力；这里全部 deny，外跳改走 edt-app:open-external。
 * 3) will-navigate —— 主窗口自身永远不该整页导航（SPA 走 history API）；被注入脚本或
 *    远程内容试图把整窗导航到外部地址时阻断，否则 preload 会在新页面重新注入。
 * 4) render-process-gone / certificate-error —— 记录崩溃与证书异常；证书错误保持默认中止。
 */
function hardenWindow(win: BrowserWindow): void {
  const wc = win.webContents

  wc.on('will-attach-webview', (event, webPreferences, params) => {
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

  wc.setWindowOpenHandler(() => ({ action: 'deny' }))

  wc.on('will-navigate', (event, url) => {
    if (!isAppOwnUrl(url)) {
      event.preventDefault()
      logger.warn('Blocked unexpected main-window navigation', { url })
    }
  })

  wc.on('render-process-gone', (_event, details) => {
    logger.error('Renderer process gone', { reason: details.reason, exitCode: details.exitCode })
  })

  wc.on('certificate-error', (_event, url, error) => {
    logger.warn('Certificate error', { url, error })
    // 不调用 preventDefault：维持 Electron 默认的中止加载行为
  })
}

// 所有 webview 的顶层导航闸：只允许 http(s) / about:blank。工具域自己的域名白名单
// （如 telegram 观测页）是额外收紧；这一层保证任何 webview 都无法被导航到 file:/data: 等本地协议。
function registerWebviewGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return

    contents.on('will-navigate', (event, url) => {
      if (!isSafeWebUrl(url) && url !== 'about:blank') {
        event.preventDefault()
        logger.warn('Blocked webview navigation', { url })
      }
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

// 平台级（应用壳）IPC：数据根目录管理 / 磁盘用量 / 缓存清理 / 窗口外观（preload 命名空间 edtApp）。
// 必须在任何 safeHandle 注册之前注入 IPC 来源白名单根路径：不注就会导致打包后（file:// 协议）
// 所有 IPC 调用被误判为不可信（白名单规则见 backend/utils/ipc-sender.ts）。
function registerAppIpc(): void {
  initIpcSafety({ appPath: app.getAppPath() })

  registerAppIpcHandlers({
    applyWindowAppearance,
    getAppearanceCapabilities: () => APPEARANCE_CAPABILITIES,
    setWindowBoundsEnabled: setWindowBoundsEnabledFromUi,
    resetWindowBounds,
  })

  // 「外部打开」统一入口：window.open 已全部 deny，页面需要外跳时调用本通道，
  // 由 safeOn 统一校验调用方来源、再校验协议后用系统默认浏览器打开
  // （不再创建会继承父窗口配置的子窗口）。
  safeOn(ipcMain, EDT_APP_IPC_CHANNELS.OPEN_EXTERNAL, (_event, rawUrl: unknown) => {
    if (typeof rawUrl !== 'string' || !isSafeWebUrl(rawUrl)) return
    void shell.openExternal(rawUrl.trim())
  })
}

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

async function createWindow(): Promise<void> {
  const isMac = process.platform === 'darwin'
  // ESM 主进程产物与源码目录同构（dist-electron/electron/main.js），preload.cjs 位于同一目录。
  // import.meta.dirname 由 Node 22 提供，已处理路径里的百分号编码，安装路径含空格 / 中文时不会解析错。
  const __dirname = import.meta.dirname

  // 上次退出时的大小 / 位置；记录不可用（未开启记忆 / 屏幕变化）时是默认尺寸（位置交给 Electron 居中）
  const savedBounds = resolveWindowBoundsOptions()

  // 开发态图标（带 DEV 标识）；安装版恒为 undefined，窗口沿用系统默认图标
  const devWindowIcon = resolveDevWindowIconPath()

  mainWindow = new BrowserWindow({
    ...savedBounds.options,
    // 开发态图标（带 DEV 标识）：Windows / Linux 只能通过窗口 icon 指定；macOS 该选项无效，
    // Dock 图标由 applyDevDockIcon() 在 ready 后单独设置。见 electron/dev-icon.ts。
    ...(devWindowIcon ? { icon: devWindowIcon } : {}),
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
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
      sandbox: true,
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

  win.on('closed', () => {
    // 置空避免后续菜单 / IPC 操作已销毁的 webContents 而抛异常
    mainWindow = null
  })

  // ── 记录窗口几何 ──
  // 最大化 / 全屏下也记录：取 getNormalBounds() 的还原尺寸，下次仍以同样大小建窗；
  // 最小化时不记录（那是临时状态，不代表用户想要的大小）。
  let boundsTimer: ReturnType<typeof setTimeout> | null = null
  const recordBoundsNow = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    recordWindowBounds(win.getNormalBounds(), win.isMaximized())
  }
  const scheduleBoundsRecord = () => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      boundsTimer = null
      recordBoundsNow()
    }, WINDOW_BOUNDS_SAVE_DELAY)
  }
  win.on('resize', scheduleBoundsRecord)
  win.on('move', scheduleBoundsRecord)
  win.on('maximize', scheduleBoundsRecord)
  win.on('unmaximize', scheduleBoundsRecord)
  win.on('close', () => {
    // 退出前把攒着的记录立刻写掉：异步 / 定时器都可能来不及跑
    if (boundsTimer) {
      clearTimeout(boundsTimer)
      boundsTimer = null
    }
    recordBoundsNow()
  })

  // 上次退出时是最大化：先按记录的普通态几何建窗再最大化，还原后回到原来的大小
  if (savedBounds.maximized) win.maximize()

  if (isDevServer) {
    await win.loadURL('http://localhost:5173')
    // 本地开发默认不自动打开 DevTools（菜单「开发者工具」/F12 随时可开）；
    // 需要调试启动问题时用 EDT_DEVTOOLS=1 显式开启
    if (process.env.EDT_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    await win.loadFile(path.join(app.getAppPath(), 'dist/index.html'))
  }
}

async function bootstrap(): Promise<void> {
  // 第二个实例：把已有窗口拉到前台即可（窗口创建在 whenReady 内，这里只聚焦已有窗口）
  app.on('second-instance', () => {
    const win = mainWindow
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.on('child-process-gone', (_event, details) => {
    logger.error('Child process gone', { type: details.type, reason: details.reason, exitCode: details.exitCode })
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
  // 保证 CDP 会话与外部子进程收尾、工具后端清理真正执行完。
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

  registerWebviewGuards()
  registerAppIpc()
  buildApplicationMenu()

  await app.whenReady()

  // 开发态 Dock 图标：dock API 在 ready 之后才可用，放在这里最早——晚于建窗只会让 Dock
  // 先闪一下 Electron 默认图标。进程级设置，与窗口数量无关。
  applyDevDockIcon()

  // 主会话与所有 webview 分区的权限策略（session-created 覆盖后续动态创建的 partition）
  configureSessionPermissions(session.defaultSession)
  app.on('session-created', createdSession => configureSessionPermissions(createdSession))

  await initializeBackend()
  // 外观必须先于 createWindow 读盘：窗口构造参数（transparent / vibrancy / backgroundMaterial）
  // 只在创建时生效，之后再改只能部分切换，读不到就等于这次启动丢了用户选择。
  await loadWindowAppearance()
  // 窗口几何同样必须在 createWindow 之前读盘：恢复位置只能通过构造参数传入
  loadWindowBounds()
  await createWindow()
}

// 单实例锁：JSON store 是「进程内缓存 + 原子写」，双实例并发会 last-writer-wins 丢更新；
// 数据目录迁移（backend/utils/data-migration.ts）在启动期做复制→校验→删源，两个实例同时
// 启动还会互相踩到迁移中间态。第二个实例直接退出。
// 锁的命名空间是 userData，所以这条只约束「同一形态」：开发态与安装版各在自己的 userData 上
// 持锁，可以同时运行（backend/utils/app-instance.ts）。
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void bootstrap().catch((error) => {
    logger.error('Failed to start application', { error: error instanceof Error ? error.message : String(error) })
    dialog.showErrorBox('everydaytool 启动失败', error instanceof Error ? error.message : String(error))
    app.quit()
  })
}
