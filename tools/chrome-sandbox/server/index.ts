import { registerCacheSkipProvider } from '../../../server/utils/data-root-scan.ts'
import { getDataDirectory, loadDataDirectoryOverride } from '../../../server/utils/data-root.ts'
import { ensureDir } from '../../../server/utils/file-ops.ts'
import { registerSandboxCommands } from './commands/handlers.ts'
import { sandboxService } from './services/sandbox-service.ts'
import { closeDatabase, getDatabase, reloadDatabase } from './store/database.ts'

export const chromeSandboxService = {
  async initialize(): Promise<void> {
    await loadDataDirectoryOverride()
    await ensureDir(getDataDirectory())
    // 建共享连接时会执行所有工具域已注册的建表语句（含 env-browser）
    getDatabase()
    registerSandboxCommands()
    // 缓存清理时跳过运行中沙箱的 userData 目录（进程占用 + 避免破坏浏览器状态）
    registerCacheSkipProvider(() => sandboxService.getRunningUserDataPaths())
  },

  onDataDirectoryChanged(): void {
    // 数据根目录变更后重开数据库（config.db 指向新目录）
    reloadDatabase()
  },

  dispose(): void {
    // 共享连接由平台层统一管理，关闭前会做 WAL checkpoint
    closeDatabase()
  },
}
