import { registerIpcHandlers } from './ipc/handlers.js'
import { closeDatabase, getDatabase } from './store/database.js'
import { ensureDir } from './utils/file-ops.js'
import { getDataDirectory, loadDataDirectoryOverride } from './utils/path-helper.js'

export const chromeSandboxBackend = {
  async initialize(): Promise<void> {
    await loadDataDirectoryOverride()
    await ensureDir(getDataDirectory())
    getDatabase()
    registerIpcHandlers()
  },

  dispose(): void {
    closeDatabase()
  },
}
