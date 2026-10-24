import type {
  AppConfigUpdate,
  FingerprintUpdatePayload,
  SandboxCreatePayload,
  SandboxUpdatePayload,
} from '../../../../shared/sandbox.ts'
import { broadcastToWindows } from '../../../../server/utils/broadcast.ts'
import { registerCommand } from '../../../../server/utils/commands.ts'
import { logger } from '../../../../server/utils/logger.ts'
import { fileDialog } from '../../../../server/utils/platform.ts'
import { detectChromePath } from '../chrome/detector.ts'
import { generateRandomFingerprint } from '../fingerprint/generator.ts'
import { sandboxService, setStatusEmitter, updateSandboxFingerprint } from '../services/sandbox-service.ts'
import { withSetupState } from '../store/config-setup.ts'
import { configStore } from '../store/config-store.ts'
import { fingerprintStore } from '../store/fingerprint-store.ts'
import { SANDBOX_COMMANDS } from './channels.ts'

function broadcast(channel: string, payload: unknown): void {
  broadcastToWindows(channel, payload, {
    onError: (error: Error) => logger.warn('Failed to broadcast to window', { channel, error: error.message }),
  })
}

export function registerSandboxCommands(): void {
  setStatusEmitter(broadcast)

  registerCommand('chromeSandbox', SANDBOX_COMMANDS.SANDBOX_GET_ALL, () => sandboxService.getAll())

  registerCommand('chromeSandbox', SANDBOX_COMMANDS.SANDBOX_CREATE, async (data: SandboxCreatePayload) => {
    try {
      return await sandboxService.create(data)
    } catch (error) {
      logger.error('sandbox:create failed', { error: (error as Error).message })
      throw error
    }
  })

  registerCommand('chromeSandbox', SANDBOX_COMMANDS.SANDBOX_DELETE, (sandboxId: string) => sandboxService.delete(sandboxId))
  registerCommand('chromeSandbox', SANDBOX_COMMANDS.SANDBOX_ACTIVATE, (sandboxId: string) => sandboxService.activate(sandboxId))
  registerCommand('chromeSandbox', SANDBOX_COMMANDS.SANDBOX_CLOSE, (sandboxId: string) => sandboxService.close(sandboxId))
  registerCommand('chromeSandbox', SANDBOX_COMMANDS.SANDBOX_UPDATE, (sandboxId: string, data: SandboxUpdatePayload) => sandboxService.update(sandboxId, data))
  registerCommand('chromeSandbox', SANDBOX_COMMANDS.SANDBOX_REFRESH_STATUS, (sandboxId: string) => sandboxService.refreshStatus(sandboxId))

  registerCommand('chromeSandbox', SANDBOX_COMMANDS.FINGERPRINT_GENERATE_RANDOM, () => generateRandomFingerprint())
  registerCommand('chromeSandbox', SANDBOX_COMMANDS.FINGERPRINT_GET_BY_ID, (fingerprintId: string) => fingerprintStore.getById(fingerprintId))
  registerCommand('chromeSandbox', SANDBOX_COMMANDS.FINGERPRINT_UPDATE, (sandboxId: string, data: FingerprintUpdatePayload) => updateSandboxFingerprint(sandboxId, data))

  registerCommand('chromeSandbox', SANDBOX_COMMANDS.CHROME_DETECT_PATH, () => detectChromePath())
  registerCommand('chromeSandbox', SANDBOX_COMMANDS.CONFIG_GET, async () => withSetupState(configStore.getAll()))
  registerCommand('chromeSandbox', SANDBOX_COMMANDS.CONFIG_SELECT_DATA_DIRECTORY, async () => {
    const result = await fileDialog.open({
      title: '选择数据目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })
  // 数据目录变更统一走平台级 edt-app:data-directory:update（会通知所有工具域重载），
  // 这里只保存 Chrome 沙箱自身的配置项，避免出现第二条只重载本域数据库的旁路。
  registerCommand('chromeSandbox', SANDBOX_COMMANDS.CONFIG_UPDATE, async (rawData: AppConfigUpdate) => {
    const { dataDirectory: _ignored, ...data } = rawData ?? {}
    const config = configStore.update(data)
    return withSetupState(config, { dataDirectoryChanged: false })
  })
}
