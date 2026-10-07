import type { ShellMenuAction } from '../shared/types.js'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { registerAppIpcHandlers } from '../backend/ipc/handlers.js'
import { SHELL_MENUS } from '../shared/menu.js'
import { notifyDataDirectoryChanged, toolBackends } from './tool-registry.js'

const require = createRequire(import.meta.url)
const { app, BrowserWindow, Menu, ipcMain } = require('electron') as typeof import('electron')

// everydaytool 本体不对外暴露 Chromium 远程调试端口（CDP 仅用于注入外部应用）
app.commandLine.appendSwitch('remote-debugging-port', '0')

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
      ...items.map<Electron.MenuItemConstructorOptions>(({ label: itemLabel, action, divided }) => ({
        label: itemLabel,
        role: ACTION_ROLES[action],
        ...(divided ? { type: 'separator' as const } : {}),
      })),
      ...(label === '视图' ? [{ type: 'separator' as const }, { role: 'togglefullscreen' as const, label: '全屏' }] : []),
    ],
  })),
]

Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))

const isDev = process.env.NODE_ENV === 'development'

// 编译产物 dist-electron/electron/main.js 中 import.meta.url 仍指向本文件所在目录，
// preload.cjs 与 ../dist/index.html 的相对关系与源码一致。
const __dirname = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'))

let mainWindow: Electron.BrowserWindow | null = null
let backendInitialized = false

// 自定义标题栏：header 即标题栏，右上角用原生 titleBarOverlay 窗口按钮。
// overlay 是不透明矩形，配色取 .app-header 表面色（Telegram 浅色主题，纯白）。
const TITLEBAR_COLORS = { color: '#ffffff', symbolColor: '#000000' } as const

function adjustZoom(delta: number) {
  const wc = (BrowserWindow.getFocusedWindow() ?? mainWindow)?.webContents
  if (wc) wc.setZoomLevel(wc.getZoomLevel() + delta)
}

// 页内菜单动作的 IPC 入口（页内菜单已移除，桥接保留备用；动作定义见 shared/types.ts）。
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

// 平台级（应用壳）IPC：数据根目录管理 / 磁盘用量 / 缓存清理（preload 命名空间 edtApp）
registerAppIpcHandlers({ notifyDataDirectoryChanged })

async function initializeBackend(): Promise<void> {
  if (backendInitialized) return
  backendInitialized = true

  for (const backend of toolBackends) {
    await backend.initialize()
  }
}

async function disposeBackend(): Promise<void> {
  for (const backend of [...toolBackends].reverse()) {
    await backend.dispose?.()
  }
}

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
      ? {}
      : {
          titleBarOverlay: {
            color: TITLEBAR_COLORS.color,
            symbolColor: TITLEBAR_COLORS.symbolColor,
            height: 44,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
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

app.on('before-quit', async () => {
  await disposeBackend()
})
