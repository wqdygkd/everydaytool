import fs from 'fs-extra';
import { registerIpcHandlers } from './ipc/handlers.js';
import { closeDatabase, getDatabase } from './store/database.js';
import { getDataDirectory, loadDataDirectoryOverride } from './utils/path-helper.js';

export const chromeSandboxBackend = {
  async initialize(): Promise<void> {
    await loadDataDirectoryOverride();
    await fs.ensureDir(getDataDirectory());
    getDatabase();
    registerIpcHandlers();
  },

  dispose(): void {
    closeDatabase();
  },
};
