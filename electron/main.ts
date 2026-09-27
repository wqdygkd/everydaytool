import type { ShellMenuAction } from '../shared/types.js'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { toolBackends } from './tool-registry.js'

const require = createRequire(import.meta.url)
const { app, BrowserWindow, Menu, ipcMain } = require('electron') as typeof import('electron')

// everydaytool 本体不对外暴露 Chromium 远程调试端口（CDP 仅用于注入外部应用）
app.commandLine.appendSwitch('remote-debugging-port', '0')

// 应用菜单：Windows/Linux 渲染在系统菜单栏位置（标题栏下方），macOS 在屏幕顶部菜单栏。
// role 自带标准行为与快捷键（Ctrl+C/V/R、F12 等），仅用中文标签覆盖显示文本。
const menuTemplate: Electron.MenuItemConstructorOptions[] = [
  ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
  {
    label: '文件',
    submenu: [
      { role: 'quit', label: '退出' },
    ],
  },
  {
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' },
    ],
  },
  {
    label: '视图',
    submenu: [
      { role: 'reload', label: '重新加载' },
      { role: 'forceReload', label: '强制重新加载' },
      { role: 'toggleDevTools', label: '开发者工具' },
      { type: 'separator' },
      { role: 'resetZoom', label: '重置缩放' },
      { role: 'zoomIn', label: '放大' },
      { role: 'zoomOut', label: '缩小' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: '全屏' },
    ],
  },
  {
    label: '窗口',
    submenu: [
      { role: 'minimize', label: '最小化' },
      { role: 'close', label: '关闭窗口' },
    ],
  },
]

Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))

const isDev = process.env.NODE_ENV === 'development'

// 编译产物 dist-electron/electron/main.js 中 import.meta.url 仍指向本文件所在目录，
// preload.cjs 与 ../dist/index.html 的相对关系与源码一致。
const __dirname = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'))

let mainWindow: Electron.BrowserWindow | null = null
let backendInitialized = false

// 自定义标题栏（VS Code 风格）：header 即标题栏，右上角用原生 titleBarOverlay 窗口按钮。
// overlay 是不透明矩形，配色取 .app-header 表面在浅色主题下的混合色（应用固定浅色）。
const TITLEBAR_COLORS = { color: '#fefdfd', symbolColor: '#181113' } as const

function adjustZoom(delta: number) {
  const wc = (BrowserWindow.getFocusedWindow() ?? mainWindow)?.webContents
  if (wc) wc.setZoomLevel(wc.getZoomLevel() + delta)
}

// 页内菜单（AppMenuBar）的动作入口（动作定义见 shared/types.ts 的 ShellMenuAction）。
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
    // 隐藏系统标题栏，网页头部即标题栏（菜单在标题后，VS Code 风格）；
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
    mainWindow.webContents.openDevTools({ mode: 'detach' })
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
