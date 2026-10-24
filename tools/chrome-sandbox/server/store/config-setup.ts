import type { AppConfig, SetupState } from '../../../../shared/sandbox.ts'
import { isDataDirectoryConfigured, markDataDirectoryConfigured } from '../../../../server/utils/data-root.ts'
import { logger } from '../../../../server/utils/logger.ts'
import { getDatabase } from './database.ts'

async function resolveDataDirectoryConfigured(): Promise<boolean> {
  if (await isDataDirectoryConfigured()) {
    return true
  }

  try {
    const hasSandbox = getDatabase().prepare('SELECT 1 FROM sandboxes LIMIT 1').get()
    if (hasSandbox) {
      await markDataDirectoryConfigured()
      return true
    }
  } catch (error) {
    logger.warn('Failed to check sandbox migration state', { error: (error as Error).message })
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
