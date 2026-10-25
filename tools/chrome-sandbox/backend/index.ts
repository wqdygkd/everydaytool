import { registerCacheSkipProvider } from '../../../backend/utils/data-root-scan.ts'
import { getDataDirectory, loadDataDirectoryOverride } from '../../../backend/utils/data-root.ts'
import { ensureDir } from '../../../backend/utils/file-ops.ts'
import { registerIpcHandlers } from './ipc/handlers.ts'
import { sandboxService } from './services/sandbox-service.ts'
import { ensureChromeSandboxLayout, getChromeSandboxDataDirectory } from './utils/path-helper.ts'

export const chromeSandboxBackend = {
  async initialize(): Promise<void> {
    await loadDataDirectoryOverride()
    await ensureDir(getDataDirectory())
    await ensureDir(getChromeSandboxDataDirectory())
    // 旧布局 <data>/sandboxes、<data>/shared 收进工具文件夹；运行中的 Chrome 占用时自动回退旧布局
    ensureChromeSandboxLayout()
    registerIpcHandlers()
    // 缓存清理时跳过运行中沙箱的 userData 目录（进程占用 + 避免破坏浏览器状态）
    registerCacheSkipProvider(() => sandboxService.getRunningUserDataPaths())
  },
}
