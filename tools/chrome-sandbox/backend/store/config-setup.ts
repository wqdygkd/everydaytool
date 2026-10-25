import type { AppConfig, SetupState } from '../../../../shared/sandbox.ts'
import { isDataDirectoryConfigured, markDataDirectoryConfigured } from '../../../../backend/utils/data-root.ts'
import { sandboxStore } from './sandbox-store.ts'

/** 已配置过数据目录，或本地已有沙箱数据（老用户升级）——都视为已完成首次配置 */
async function resolveDataDirectoryConfigured(): Promise<boolean> {
  if (await isDataDirectoryConfigured()) {
    return true
  }

  if (sandboxStore.getAll().length > 0) {
    await markDataDirectoryConfigured()
    return true
  }

  return false
}

export async function withSetupState(
  config: AppConfig,
  extra: Record<string, unknown> = {},
): Promise<SetupState> {
  const dataDirectoryConfigured = await resolveDataDirectoryConfigured()
  return {
    ...config,
    dataDirectory: dataDirectoryConfigured ? config.dataDirectory : '',
    dataDirectoryConfigured,
    ...extra,
  }
}
