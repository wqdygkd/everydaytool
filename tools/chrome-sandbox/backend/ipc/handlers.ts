import { createRequire } from 'module';
import { IPC_CHANNELS } from './channels.js';
import { sandboxService, updateSandboxFingerprint } from '../services/sandbox-service.js';
import { fingerprintStore } from '../store/fingerprint-store.js';
import { configStore } from '../store/config-store.js';
import { withSetupState } from '../store/config-setup.js';
import { detectChromePath } from '../chrome/detector.js';
import { generateRandomFingerprint } from '../fingerprint/generator.js';
import { setStatusEmitter } from '../services/sandbox-service.js';
import { applyDataDirectoryChange, markDataDirectoryConfigured } from '../utils/path-helper.js';
import { reloadDatabase } from '../store/database.js';
import { logger } from '../utils/logger.js';
import type {
  AppConfigUpdate,
  FingerprintUpdatePayload,
  SandboxCreatePayload,
  SandboxUpdatePayload,
} from '../../../../shared/types.js';

const require = createRequire(import.meta.url);
const { ipcMain, BrowserWindow, dialog } = require('electron') as typeof import('electron');

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

export function registerIpcHandlers(): void {
  setStatusEmitter(broadcast);

  ipcMain.handle(IPC_CHANNELS.SANDBOX_GET_ALL, () => sandboxService.getAll());

  ipcMain.handle(IPC_CHANNELS.SANDBOX_CREATE, async (_event, data: SandboxCreatePayload) => {
    try {
      return await sandboxService.create(data);
    } catch (error) {
      logger.error('sandbox:create failed', { error: (error as Error).message });
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.SANDBOX_DELETE, (_event, sandboxId: string) => sandboxService.delete(sandboxId));
  ipcMain.handle(IPC_CHANNELS.SANDBOX_ACTIVATE, (_event, sandboxId: string) => sandboxService.activate(sandboxId));
  ipcMain.handle(IPC_CHANNELS.SANDBOX_CLOSE, (_event, sandboxId: string) => sandboxService.close(sandboxId));
  ipcMain.handle(IPC_CHANNELS.SANDBOX_UPDATE, (_event, sandboxId: string, data: SandboxUpdatePayload) => sandboxService.update(sandboxId, data));
  ipcMain.handle(IPC_CHANNELS.SANDBOX_REFRESH_STATUS, (_event, sandboxId: string) => sandboxService.refreshStatus(sandboxId));

  ipcMain.handle(IPC_CHANNELS.FINGERPRINT_GENERATE_RANDOM, () => generateRandomFingerprint());
  ipcMain.handle(IPC_CHANNELS.FINGERPRINT_GET_BY_ID, (_event, fingerprintId: string) => fingerprintStore.getById(fingerprintId));
  ipcMain.handle(IPC_CHANNELS.FINGERPRINT_UPDATE, (_event, sandboxId: string, data: FingerprintUpdatePayload) => updateSandboxFingerprint(sandboxId, data));

  ipcMain.handle(IPC_CHANNELS.CHROME_DETECT_PATH, () => detectChromePath());
  ipcMain.handle(IPC_CHANNELS.CONFIG_GET, async () => withSetupState(configStore.getAll()));
  ipcMain.handle(IPC_CHANNELS.CONFIG_SELECT_DATA_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择数据目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });
  ipcMain.handle(IPC_CHANNELS.CONFIG_UPDATE, async (_event, data: AppConfigUpdate) => {
    let dataDirectoryChanged = false;

    if (data?.dataDirectory !== undefined) {
      const result = await applyDataDirectoryChange(data.dataDirectory);
      data.dataDirectory = result.dataDirectory;
      if (result.changed) {
        reloadDatabase();
        dataDirectoryChanged = true;
      }
      await markDataDirectoryConfigured();
    }

    const config = configStore.update(data);
    return withSetupState(config, { dataDirectoryChanged });
  });
}
