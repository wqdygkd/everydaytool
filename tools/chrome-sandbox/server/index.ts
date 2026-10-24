import { registerCacheSkipProvider } from '../../../server/utils/data-root-scan.ts'
import { getDataDirectory, loadDataDirectoryOverride } from '../../../server/utils/data-root.ts'
import { ensureDir } from '../../../server/utils/file-ops.ts'
import { registerSandboxCommands } from './commands/handlers.ts'
import { sandboxService } from './services/sandbox-service.ts'
import { resetConfigStore } from './store/config-store.ts'
import { resetFingerprintStore } from './store/fingerprint-store.ts'
import { resetSandboxStore } from './store/sandbox-store.ts'

export const chromeSandboxService = {
  async initialize(): Promise<void> {
    await loadDataDirectoryOverride()
    await ensureDir(getDataDirectory())
    registerSandboxCommands()
    // 缓存清理时跳过运行中沙箱的 userData 目录（进程占用 + 避免破坏浏览器状态）
    registerCacheSkipProvider(() => sandboxService.getRunningUserDataPaths())
  },

  onDataDirectoryChanged(): void {
    // 数据根目录变更后丢弃 JSON 存储缓存，下次访问按新目录重读
    resetSandboxStore()
    resetFingerprintStore()
    resetConfigStore()
  },
}
