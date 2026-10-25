import type {
  AppConfigUpdate,
  FingerprintUpdatePayload,
  SandboxCreatePayload,
  SandboxUpdatePayload,
} from '../../../../shared/sandbox.ts'
import { dialog, ipcMain } from 'electron'
import { broadcastToWindows } from '../../../../backend/utils/broadcast.ts'
import { safeHandle } from '../../../../backend/utils/ipc-safety.ts'
import { logger } from '../../../../backend/utils/logger.ts'
import { detectChromePath } from '../chrome/detector.ts'
import { generateRandomFingerprint } from '../fingerprint/generator.ts'
import { sandboxService, setStatusEmitter, updateSandboxFingerprint } from '../services/sandbox-service.ts'
import { withSetupState } from '../store/config-setup.ts'
import { configStore } from '../store/config-store.ts'
import { fingerprintStore } from '../store/fingerprint-store.ts'
import { CHROME_SANDBOX_IPC_CHANNELS } from './channels.ts'

function broadcast(channel: string, payload: unknown): void {
  broadcastToWindows(channel, payload, {
    onError: (error: Error) => logger.warn('Failed to broadcast to window', { channel, error: error.message }),
  })
}

export function registerIpcHandlers(): void {
  setStatusEmitter(broadcast)

  safeHandle(ipcMain, CHROME_SANDBOX_IPC_CHANNELS.SANDBOX_GET_ALL, () => sandboxService.getAll())

  safeHandle(ipcMain, CHROME_SANDBOX_IPC_CHANNELS.SANDBOX_CREATE, async (_event, data: SandboxCreatePayload) => {
    try {
      return await sandboxService.create(data)
    } catch (error) {
      logger.error('sandbox:create failed', { error: (error as Error).message })
      throw error
    }
  })

  safeHandle(ipcMain, CHROME_SANDBOX_IPC_CHANNELS.SANDBOX_DELETE, (_event, sandboxId: string) => sandboxService.delete(sandboxId))
  safeHandle(ipcMain, CHROME_SANDBOX_IPC_CHANNELS.SANDBOX_ACTIVATE, (_event, sandboxId: string) => sandboxService.activate(sandboxId))
  safeHandle(ipcMain, CHROME_SANDBOX_IPC_CHANNELS.SANDBOX_CLOSE, (_event, sandboxId: string) => sandboxService.close(sandboxId))
  safeHandle(ipcMain, CHROME_SANDBOX_IPC_CHANNELS.SANDBOX_UPDATE, (_event, sandboxId: string, data: SandboxUpdatePayload) => sandboxService.update(sandboxId, data))
  safeHandle(ipcMain, CHROME_SANDBOX_IPC_CHANNELS.SANDBOX_REFRESH_STATUS, (_event, sandboxId: string) => sandboxService.refreshStatus(sandboxId))

  safeHandle(ipcMain, CHROME_SANDBOX_IPC_CHANNELS.FINGERPRINT_GENERATE_RANDOM, () => generateRandomFingerprint())
  safeHandle(ipcMain, CHROME_SANDBOX_IPC_CHANNELS.FINGERPRINT_GET_BY_ID, (_event, fingerprintId: string) => fingerprintStore.getById(fingerprintId))
  safeHandle(ipcMain, CHROME_SANDBOX_IPC_CHANNELS.FINGERPRINT_UPDATE, (_event, sandboxId: string, data: FingerprintUpdatePayload) => updateSandboxFingerprint(sandboxId, data))

  safeHandle(ipcMain, CHROME_SANDBOX_IPC_CHANNELS.CHROME_DETECT_PATH, () => detectChromePath())
  safeHandle(ipcMain, CHROME_SANDBOX_IPC_CHANNELS.CONFIG_GET, async () => withSetupState(configStore.getAll()))
  safeHandle(ipcMain, CHROME_SANDBOX_IPC_CHANNELS.CONFIG_SELECT_DATA_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择数据目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })
  // 数据目录变更统一走平台级 edt-app:data-directory:update（写入 pending，下次启动整体迁移），
  // 这里只保存 Chrome 沙箱自身的配置项，避免出现第二条只重载本域数据库的旁路。
  safeHandle(ipcMain, CHROME_SANDBOX_IPC_CHANNELS.CONFIG_UPDATE, async (_event, rawData: AppConfigUpdate) => {
    const { dataDirectory: _ignored, ...data } = rawData ?? {}
    const config = configStore.update(data)
    return withSetupState(config, { dataDirectoryChanged: false })
  })
}
