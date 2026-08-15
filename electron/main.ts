import { createRequire } from 'module';
import path from 'path';
import fs from 'fs-extra';
import { registerIpcHandlers } from '../tools/chrome-sandbox/backend/ipc/handlers.js';
import { registerCdpInjectorHandlers } from '../tools/cdp-injector/backend/ipc/handlers.js';
import { injectorService } from '../tools/cdp-injector/backend/services/injector-service.js';
import { getDatabase, closeDatabase } from '../tools/chrome-sandbox/backend/store/database.js';
import { loadDataDirectoryOverride, getDataDirectory } from '../tools/chrome-sandbox/backend/utils/path-helper.js';
import { logger } from '../tools/chrome-sandbox/backend/utils/logger.js';

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require('electron') as typeof import('electron');

// everydaytool 本体不对外暴露 Chromium 远程调试端口（CDP 仅用于注入外部应用）
app.commandLine.appendSwitch('remote-debugging-port', '0');

const isDev = process.env.NODE_ENV === 'development';

// 编译产物 dist-backend/electron/main.js 中 import.meta.url 仍指向本文件所在目录，
// preload.cjs 与 ../dist/index.html 的相对关系与源码一致。
const __dirname = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

let mainWindow: Electron.BrowserWindow | null = null;
let backendInitialized = false;

async function initializeBackend(): Promise<void> {
  if (backendInitialized) return;
  backendInitialized = true;

  await loadDataDirectoryOverride();
  await fs.ensureDir(getDataDirectory());
  getDatabase();
  registerIpcHandlers();
  registerCdpInjectorHandlers();
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: 'everydaytool',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
  }
}

app.whenReady().then(async () => {
  await initializeBackend();
  await createWindow();
});

app.on('window-all-closed', () => {
  closeDatabase();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

app.on('before-quit', async () => {
  await injectorService.stopAll();
  closeDatabase();
  logger.info('Application quitting');
});
