import { registerCacheSkipProvider } from '../../../backend/utils/data-root-scan.ts'
import { getDataDirectory, loadDataDirectoryOverride } from '../../../backend/utils/data-root.ts'
import { ensureDir } from '../../../backend/utils/file-ops.ts'
import { registerIpcHandlers } from './ipc/handlers.ts'
import { sandboxService } from './services/sandbox-service.ts'
import { getChromeSandboxDataDirectory } from './utils/path-helper.ts'

export const chromeSandboxBackend = {
  async initialize(): Promise<void> {
    await loadDataDirectoryOverride()
    await ensureDir(getDataDirectory())
    await ensureDir(getChromeSandboxDataDirectory())
    registerIpcHandlers()
    // 缓存清理时跳过运行中沙箱的 userData 目录（进程占用 + 避免破坏浏览器状态）
    registerCacheSkipProvider(() => sandboxService.getRunningUserDataPaths())
  },
}
