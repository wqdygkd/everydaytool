import { registerCacheSkipProvider } from '../../../backend/utils/data-root-scan.js'
import { getDataDirectory, loadDataDirectoryOverride } from '../../../backend/utils/data-root.js'
import { ensureDir } from '../../../backend/utils/file-ops.js'
import { registerIpcHandlers } from './ipc/handlers.js'
import { sandboxService } from './services/sandbox-service.js'
import { closeDatabase, getDatabase, reloadDatabase } from './store/database.js'

export const chromeSandboxBackend = {
  async initialize(): Promise<void> {
    await loadDataDirectoryOverride()
    await ensureDir(getDataDirectory())
    getDatabase()
    registerIpcHandlers()
    // 缓存清理时跳过运行中沙箱的 userData 目录（进程占用 + 避免破坏浏览器状态）
    registerCacheSkipProvider(() => sandboxService.getRunningUserDataPaths())
  },

  onDataDirectoryChanged(): void {
    // 数据根目录变更后重开数据库（config.db 指向新目录）
    reloadDatabase()
  },

  dispose(): void {
    closeDatabase()
  },
}
