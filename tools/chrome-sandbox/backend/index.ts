import { getDataDirectory, loadDataDirectoryOverride } from '../../../backend/utils/data-root.js'
import { ensureDir } from '../../../backend/utils/file-ops.js'
import { registerIpcHandlers } from './ipc/handlers.js'
import { closeDatabase, getDatabase } from './store/database.js'

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
